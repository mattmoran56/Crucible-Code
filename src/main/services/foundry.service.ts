/**
 * Foundry — autopilot orchestrator over a Notion task set.
 *
 * Lifecycle of a task ("pipeline"):
 *   spawn-requested → implementing → reviewing → finalizing → done
 *
 * The worker session is responsible for committing, pushing, and opening the
 * draft PR; the foundry polls findPRForBranch (15s) and advances on detection.
 *
 * The deterministic FSM lives here; the brain (which tasks to start, in what
 * order) is the Foreman pass, see foundry-foreman.service.ts.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { BrowserWindow } from 'electron'
import Store from 'electron-store'
import { IPC } from '../../shared/constants'
import type {
  FoundryConfig,
  FoundryFireTaskPayload,
  FoundryPipeline,
  FoundryPipelinePhase,
  FoundryPipelineAction,
  FoundryRuntimeState,
  FoundryTaskStartedAck,
  FoundryWorkerPermissionMode,
  NotionPropertyFilter,
  NotionTaskPayload,
  ReviewLoopState,
} from '../../shared/types'
import { getStorePath } from '../store-path'
import { eventBus, emitToRenderer } from './event-bus'
import {
  appendMarkdownBlocks,
  getEffectiveFilterGroups,
  queryDatabase,
  resolvePlaceholders,
  slugify,
  updatePageProperties,
} from './notion.service'
import { addPickedUp, loadConfig as loadNotionConfig } from './notion-poller.service'
import { findPRForBranch, markPRReady } from './github.service'
import { getDefaultBranch } from './git.service'
import { startReviewLoopLite } from './review-loop-lite.service'
import { runHeadlessClaude } from './claude-headless.service'
import { getTerminalBuffer, listTerminalsForSession, writeTerminal } from './terminal.service'

const execFileAsync = promisify(execFile)

const WATCH_INTERVAL_MS = 20_000
const REQUEST_PASS_DEBOUNCE_MS = 5_000
const PR_POLL_INTERVAL_MS = 15_000
const SAFETY_NET_PASS_INTERVAL_MS = 10 * 60_000
const ACK_TIMEOUT_MS = 30_000
const ACK_REFIRE_MAX = 3
const STARTUP_RENDERER_BUFFER_MS = 2_500
const DEFAULT_IMPLEMENT_TIMEOUT_MIN = 60
const DEFAULT_MAX_CONCURRENCY = 2

const PERMISSION_MODE_ARGS: Record<FoundryWorkerPermissionMode, string[]> = {
  bypassPermissions: ['--dangerously-skip-permissions'],
  acceptEdits: ['--permission-mode', 'acceptEdits'],
  default: [],
}

interface ConfigStoreShape {
  foundries: FoundryConfig[]
}
interface StateStoreShape {
  states: Record<string, FoundryRuntimeState>
}

const configStore = new Store<ConfigStoreShape>({
  cwd: getStorePath(),
  name: 'foundry-config',
  defaults: { foundries: [] },
})

const stateStore = new Store<StateStoreShape>({
  cwd: getStorePath(),
  name: 'foundry-state',
  defaults: { states: {} },
})

interface FoundryRuntime {
  config: FoundryConfig
  state: FoundryRuntimeState
  watchTimer?: ReturnType<typeof setInterval>
  prPollTimer?: ReturnType<typeof setInterval>
  safetyNetTimer?: ReturnType<typeof setInterval>
  passDebounceTimer?: ReturnType<typeof setTimeout>
  passRerunRequested?: boolean
  pipelineAcks: Map<string, { fired: number; timer?: ReturnType<typeof setTimeout> }>
  advancing: Set<string>
}

const runtimes = new Map<string, FoundryRuntime>()
let mainWindow: BrowserWindow | null = null
let started = false
let unsubReviewLoop: (() => void) | null = null
let unsubSessionStatus: (() => void) | null = null

/** Listener slot for the foreman module — populated by registerForemanRunner. */
let runForemanPass:
  | ((opts: { foundryId: string; trigger: import('../../shared/types').FoundryPassTrigger }) => Promise<void>)
  | null = null

export function registerForemanRunner(
  runner: (opts: { foundryId: string; trigger: import('../../shared/types').FoundryPassTrigger }) => Promise<void>
): void {
  runForemanPass = runner
}

// ── Public API ──────────────────────────────────────────────────────────────

export function listConfigs(): FoundryConfig[] {
  return loadAllConfigsFresh()
}

function loadAllConfigsFresh(): FoundryConfig[] {
  const fresh = new Store<ConfigStoreShape>({
    cwd: getStorePath(),
    name: 'foundry-config',
    defaults: { foundries: [] },
  })
  return fresh.get('foundries', [])
}

function loadStateFresh(foundryId: string): FoundryRuntimeState | null {
  const fresh = new Store<StateStoreShape>({
    cwd: getStorePath(),
    name: 'foundry-state',
    defaults: { states: {} },
  })
  const all = fresh.get('states', {})
  const state = all[foundryId] ?? null
  // A state file bloated by a prior unbounded run would otherwise load in full
  // and stay large until the first save. Trim it on the way in so memory is
  // bounded from the moment the runtime hydrates.
  if (state) pruneState(state)
  return state
}

export function saveConfig(config: FoundryConfig): FoundryConfig[] {
  const all = configStore.get('foundries', [])
  const idx = all.findIndex((f) => f.id === config.id)
  if (idx >= 0) all[idx] = config
  else all.push(config)
  configStore.set('foundries', all)
  syncRuntimeForConfig(config)
  return all
}

export function deleteConfig(foundryId: string): FoundryConfig[] {
  const all = configStore.get('foundries', []).filter((f) => f.id !== foundryId)
  configStore.set('foundries', all)
  const rt = runtimes.get(foundryId)
  if (rt) {
    teardownRuntime(rt)
    // Existing pipelines become orphaned (worktrees/sessions stay so the user
    // can salvage them).
    for (const p of rt.state.pipelines) {
      if (!isTerminal(p.phase)) p.phase = 'orphaned'
    }
    saveState(rt)
    runtimes.delete(foundryId)
  }
  const states = stateStore.get('states', {})
  delete states[foundryId]
  stateStore.set('states', states)
  return all
}

export function setPaused(foundryId: string, paused: boolean): void {
  const cfg = loadAllConfigsFresh().find((f) => f.id === foundryId)
  if (!cfg) return
  saveConfig({ ...cfg, paused })
}

export function getState(foundryId: string): FoundryRuntimeState | null {
  return runtimes.get(foundryId)?.state ?? loadStateFresh(foundryId)
}

/**
 * Wipe runtime state — pipelines, passes, snapshot, documented hashes,
 * planMarkdownHash, foremanClaudeSessionId, lastError. Keeps the config
 * intact. Refused while the foundry is enabled, so the user can't yank
 * state out from under live workers.
 */
export function resetState(foundryId: string): { ok: boolean; reason?: string } {
  const cfg = loadAllConfigsFresh().find((f) => f.id === foundryId)
  if (!cfg) return { ok: false, reason: 'foundry not found' }
  if (cfg.enabled && !cfg.paused) {
    return { ok: false, reason: 'turn the foundry off before resetting' }
  }
  console.log(`[foundry:${foundryId}] reset state`)
  const rt = runtimes.get(foundryId)
  const cleared: FoundryRuntimeState = {
    foundryId,
    pageStatusSnapshot: {},
    documentedHashes: {},
    pipelines: [],
    passes: [],
    passInFlight: false,
  }
  if (rt) {
    // Cancel any in-flight ack timers and rerun requests.
    for (const a of rt.pipelineAcks.values()) {
      if (a.timer) clearTimeout(a.timer)
    }
    rt.pipelineAcks.clear()
    rt.advancing.clear()
    rt.passRerunRequested = false
    rt.state = cleared
    saveAndEmit(rt)
  } else {
    const all = stateStore.get('states', {})
    all[foundryId] = cleared
    stateStore.set('states', all)
    if (mainWindow && !mainWindow.isDestroyed()) {
      emitToRenderer(mainWindow, IPC.FOUNDRY_STATE_UPDATE, foundryId, structuredClone(cleared))
    }
  }
  return { ok: true }
}

export function runPassNow(foundryId: string): void {
  const rt = runtimes.get(foundryId)
  if (!rt) return
  requestPass(rt, 'manual', /*immediate*/ true)
}

export function pipelineAction(
  foundryId: string,
  pipelineId: string,
  action: FoundryPipelineAction
): void {
  const rt = runtimes.get(foundryId)
  if (!rt) return
  const p = rt.state.pipelines.find((pp) => pp.id === pipelineId)
  if (!p) return
  switch (action) {
    case 'cancel':
      p.phase = 'cancelled'
      p.attention = undefined
      log(p, 'Pipeline cancelled by user.')
      saveAndEmit(rt)
      break
    case 'resume':
      if (p.phase === 'cancelled' || p.attention) {
        p.attention = undefined
        // Pick up where we left off — re-poll the PR for implementing
        // pipelines, restart the review loop for reviewing ones.
        if (p.phase === 'implementing') {
          void checkPRForPipeline(rt, p).catch((err: unknown) => {
            log(p, `Resume failed: ${err instanceof Error ? err.message : String(err)}`)
            saveAndEmit(rt)
          })
        } else if (p.phase === 'reviewing') {
          void runReviewPhase(rt, p).catch((err: unknown) => {
            log(p, `Resume failed: ${err instanceof Error ? err.message : String(err)}`)
            saveAndEmit(rt)
          })
        }
        log(p, 'Resume requested.')
        saveAndEmit(rt)
      }
      break
    case 'retry-phase':
      void retryPhase(rt, p)
      break
    case 'skip-phase':
      void skipPhase(rt, p)
      break
  }
}

export function ackTaskStarted(foundryId: string, ack: FoundryTaskStartedAck): void {
  const rt = runtimes.get(foundryId)
  if (!rt) return
  const p = rt.state.pipelines.find((pp) => pp.id === ack.pipelineId)
  if (!p) return
  const stash = rt.pipelineAcks.get(ack.pipelineId)
  if (stash?.timer) clearTimeout(stash.timer)
  rt.pipelineAcks.delete(ack.pipelineId)
  p.sessionId = ack.sessionId
  p.branch = ack.branch
  p.worktreePath = ack.worktreePath
  p.baseBranch = ack.baseBranch
  p.phase = 'implementing'
  log(p, `Worker session ${ack.sessionId.slice(0, 8)}… spawned on ${ack.branch}.`)
  saveAndEmit(rt)
  // Apply deferred Notion updates (branch / sessionId placeholders) for pickup.
  void applyDeferredPickupUpdates(rt, p).catch((err) =>
    log(p, `Deferred pickup updates failed: ${err instanceof Error ? err.message : String(err)}`)
  )
}

// ── Watcher + start/stop ────────────────────────────────────────────────────

export function startFoundryService(window: BrowserWindow): void {
  if (started) return
  started = true
  mainWindow = window

  // Resync runtimes from saved configs.
  for (const cfg of loadAllConfigsFresh()) syncRuntimeForConfig(cfg)

  // Subscribe to review-loop completion to advance reviewing → finalizing.
  unsubReviewLoop = subscribeOnBus(IPC.REVIEW_LOOP_STATE_UPDATE, (state: ReviewLoopState) => {
    void onReviewLoopUpdate(state)
  })
  // Subscribe to per-session hook events — used as "stop" hints for the
  // implementing phase. (See verifyImplementDone for the verification core.)
  unsubSessionStatus = subscribeOnBus(
    IPC.NOTIFICATION_SESSION_STATUS,
    (contextId: string, _tabId: string, hookType: string) => {
      if (hookType !== 'stop' && hookType !== 'notification') return
      void onSessionHookEvent(contextId, hookType)
    }
  )

  // After the renderer is ready, fire startup-time triggers + rehydrate.
  setTimeout(() => {
    for (const rt of runtimes.values()) {
      rehydrateAfterStartup(rt)
      requestPass(rt, 'startup', /*immediate*/ false)
    }
  }, STARTUP_RENDERER_BUFFER_MS)
}

export function stopFoundryService(): void {
  for (const rt of runtimes.values()) teardownRuntime(rt)
  runtimes.clear()
  if (unsubReviewLoop) unsubReviewLoop()
  if (unsubSessionStatus) unsubSessionStatus()
  unsubReviewLoop = null
  unsubSessionStatus = null
  mainWindow = null
  started = false
}

function subscribeOnBus(channel: string, listener: (...args: any[]) => void): () => void {
  eventBus.on(channel, listener)
  return () => eventBus.off(channel, listener)
}

function syncRuntimeForConfig(config: FoundryConfig): void {
  const existing = runtimes.get(config.id)
  if (existing) {
    const wasActive = existing.config.enabled && !existing.config.paused
    const nowActive = config.enabled && !config.paused
    existing.config = config
    if (nowActive) {
      ensureWatchTimer(existing)
    } else {
      stopTimers(existing)
    }
    // Off→on transition should kick the foreman immediately rather than
    // making the user wait for the 10-min safety net or a snapshot diff.
    if (!wasActive && nowActive) {
      console.log(`[foundry] ${config.id} enabled — requesting initial pass`)
      setTimeout(() => requestPass(existing, 'enabled', /*immediate*/ false), STARTUP_RENDERER_BUFFER_MS)
    }
    saveAndEmit(existing)
    return
  }
  const state: FoundryRuntimeState = loadStateFresh(config.id) ?? {
    foundryId: config.id,
    pageStatusSnapshot: {},
    documentedHashes: {},
    pipelines: [],
    passes: [],
  }
  const rt: FoundryRuntime = {
    config,
    state,
    pipelineAcks: new Map(),
    advancing: new Set(),
  }
  runtimes.set(config.id, rt)
  if (config.enabled && !config.paused) {
    ensureWatchTimer(rt)
    // Newly-enabled foundries should fire a pass once the renderer is up.
    setTimeout(() => requestPass(rt, 'enabled', false), STARTUP_RENDERER_BUFFER_MS)
  }
  saveAndEmit(rt)
}

function ensureWatchTimer(rt: FoundryRuntime): void {
  if (!rt.watchTimer) {
    rt.watchTimer = setInterval(() => void tick(rt), WATCH_INTERVAL_MS)
  }
  if (!rt.prPollTimer) {
    rt.prPollTimer = setInterval(() => void pollForPRs(rt), PR_POLL_INTERVAL_MS)
  }
  if (!rt.safetyNetTimer) {
    // Safety net — even with snapshot diffs + per-pipeline events, a missed
    // Notion edge or a network blip can leave the foundry sitting on a
    // stale plan. Force a foreman pass every ~10 minutes so the system
    // can't sit idle indefinitely.
    rt.safetyNetTimer = setInterval(
      () => requestPass(rt, 'safety-net', /*immediate*/ false),
      SAFETY_NET_PASS_INTERVAL_MS
    )
  }
}

function stopTimers(rt: FoundryRuntime): void {
  if (rt.watchTimer) clearInterval(rt.watchTimer)
  if (rt.prPollTimer) clearInterval(rt.prPollTimer)
  if (rt.safetyNetTimer) clearInterval(rt.safetyNetTimer)
  if (rt.passDebounceTimer) clearTimeout(rt.passDebounceTimer)
  rt.watchTimer = undefined
  rt.prPollTimer = undefined
  rt.safetyNetTimer = undefined
  rt.passDebounceTimer = undefined
}

function teardownRuntime(rt: FoundryRuntime): void {
  stopTimers(rt)
  for (const a of rt.pipelineAcks.values()) {
    if (a.timer) clearTimeout(a.timer)
  }
  rt.pipelineAcks.clear()
}

// ── Snapshot diff watcher ───────────────────────────────────────────────────

export async function tick(rt: FoundryRuntime): Promise<void> {
  // Re-read config so MCP-driven JSON edits land without a restart.
  const fresh = loadAllConfigsFresh().find((f) => f.id === rt.config.id)
  if (!fresh) return
  rt.config = fresh
  if (!fresh.enabled || fresh.paused) {
    console.log(`[foundry:${fresh.id}] tick skipped (enabled=${fresh.enabled} paused=${!!fresh.paused})`)
    return
  }

  const notion = notionAccess(fresh)
  if (!notion) {
    console.warn(`[foundry:${fresh.id}] tick: no notion access (token/db missing on project ${fresh.projectId})`)
    return
  }

  let pages: NotionTaskPayload[]
  try {
    pages = await queryDatabase(notion.apiToken, notion.databaseId, fresh.taskSetFilters, notion.titlePropertyName)
  } catch (err) {
    rt.state.lastError = `task-set query failed: ${err instanceof Error ? err.message : String(err)}`
    console.error(`[foundry:${fresh.id}] task-set query failed`, err)
    saveAndEmit(rt)
    return
  }
  console.log(`[foundry:${fresh.id}] tick: ${pages.length} task(s) in set`)

  const prevSnapshot = rt.state.pageStatusSnapshot
  const isFirstTick = Object.keys(prevSnapshot).length === 0
  const newSnapshot: Record<string, string> = {}
  const completionProp = fresh.completionTransition.property
  const completedStatuses = new Set(fresh.completedStatuses ?? [])
  const transitionFires: string[] = []

  for (const p of pages) {
    const status = extractStatusLike(p.rawProperties, completionProp)
    newSnapshot[p.id] = status
    if (isFirstTick) continue
    const prior = prevSnapshot[p.id]
    if (prior === status) continue
    const t = fresh.completionTransition
    if (t.toValue && status === t.toValue && (!t.fromValue || prior === t.fromValue)) {
      transitionFires.push(p.id)
      continue
    }
    if (fresh.triggerOnCompletedStatusEnter !== false && completedStatuses.has(status) && !completedStatuses.has(prior ?? '')) {
      transitionFires.push(p.id)
    }
  }
  rt.state.pageStatusSnapshot = newSnapshot
  saveAndEmit(rt)

  if (transitionFires.length > 0) {
    requestPass(rt, 'transition', /*immediate*/ false)
  }
}

function extractStatusLike(props: Record<string, unknown>, propName: string): string {
  const prop = props[propName] as Record<string, unknown> | undefined
  if (!prop || typeof prop !== 'object') return ''
  const type = String(prop.type ?? '')
  if (type === 'status' || type === 'select') {
    const val = (prop as any)[type] as { name?: string } | null
    return val?.name ?? ''
  }
  if (type === 'checkbox') return prop.checkbox ? 'true' : 'false'
  if (type === 'rich_text' || type === 'title') {
    const rt = (prop as any)[type] as Array<{ plain_text?: string }> | undefined
    return (rt ?? []).map((s) => s.plain_text ?? '').join('')
  }
  return ''
}

// ── Pass requests (debounced + single-flight) ───────────────────────────────

export function requestPass(
  rt: FoundryRuntime,
  trigger: import('../../shared/types').FoundryPassTrigger,
  immediate: boolean
): void {
  const fire = (): void => {
    if (rt.state.passInFlight) {
      console.log(`[foundry:${rt.config.id}] pass already in flight — rerun queued (trigger=${trigger})`)
      rt.passRerunRequested = true
      return
    }
    rt.state.passInFlight = true
    saveAndEmit(rt)
    const runner = runForemanPass
    if (!runner) {
      console.error(`[foundry:${rt.config.id}] foreman runner not registered`)
      rt.state.passInFlight = false
      rt.state.lastError = 'foreman runner not registered'
      saveAndEmit(rt)
      return
    }
    console.log(`[foundry:${rt.config.id}] firing foreman pass (trigger=${trigger})`)
    void runner({ foundryId: rt.config.id, trigger }).finally(() => {
      rt.state.passInFlight = false
      saveAndEmit(rt)
      if (rt.passRerunRequested) {
        rt.passRerunRequested = false
        requestPass(rt, 'transition', false)
      }
    })
  }
  if (immediate) {
    if (rt.passDebounceTimer) clearTimeout(rt.passDebounceTimer)
    rt.passDebounceTimer = undefined
    console.log(`[foundry:${rt.config.id}] requestPass(${trigger}) immediate`)
    fire()
    return
  }
  if (rt.passDebounceTimer) clearTimeout(rt.passDebounceTimer)
  console.log(`[foundry:${rt.config.id}] requestPass(${trigger}) debounced ${REQUEST_PASS_DEBOUNCE_MS}ms`)
  rt.passDebounceTimer = setTimeout(fire, REQUEST_PASS_DEBOUNCE_MS)
}

// ── Pipeline lifecycle ──────────────────────────────────────────────────────

export interface StartPipelineOptions {
  foundryId: string
  page: NotionTaskPayload
  reason: string
  /** Foreman's chosen branch (e.g. `feat/attempts-table`). Overrides the foundry's branchNameTemplate. */
  branchName?: string
  /** Foreman's chosen session label (short kebab-case). Overrides the slugified title. */
  sessionName?: string
}

export async function startPipeline(opts: StartPipelineOptions): Promise<FoundryPipeline | null> {
  const rt = runtimes.get(opts.foundryId)
  if (!rt) return null
  if (rt.state.pipelines.some((p) => p.page.id === opts.page.id && !isTerminal(p.phase))) {
    return null
  }
  if (countActivePipelines(rt) >= (rt.config.maxConcurrentTasks ?? DEFAULT_MAX_CONCURRENCY)) {
    return null
  }
  const notion = notionAccess(rt.config)
  if (!notion) return null

  // Make sure the configured base branch exists before we hand off to the
  // worktree create — otherwise the renderer's worktree.create would fail
  // and the pipeline would never start. No-op when baseBranch is unset
  // (worktree.create falls back to the repo default).
  if (rt.config.baseBranch?.trim()) {
    const repoPath = projectRepoPath(rt.config.projectId)
    if (repoPath) {
      try {
        await ensureBaseBranchExists(repoPath, rt.config.baseBranch.trim())
      } catch (err) {
        rt.state.lastError = `base branch "${rt.config.baseBranch}" could not be ensured: ${err instanceof Error ? err.message : String(err)}`
        saveAndEmit(rt)
        return null
      }
    }
  }

  const ctx = buildPlaceholderContext(opts.page)
  // Foreman-supplied names win; foundry template + slugified title are fallbacks.
  const branchTemplate = rt.config.branchNameTemplate ?? 'foundry/{{taskTitleSlug}}'
  const suggestedBranchName =
    opts.branchName?.trim() ||
    resolvePlaceholders(branchTemplate, ctx) ||
    `foundry/${opts.page.id.slice(0, 8)}`
  const suggestedSessionName =
    opts.sessionName?.trim() ||
    (opts.page.title ? slugify(opts.page.title) || `foundry-${opts.page.id.slice(0, 8)}` : `foundry-${opts.page.id.slice(0, 8)}`)
  const resolvedImplementPrompt = resolvePlaceholders(rt.config.implementCommandTemplate, ctx)

  // Apply immediate pickup updates BEFORE firing (matches notion-poller).
  const immediate = (rt.config.pickupUpdates ?? []).filter((u) => !valueReferencesSession(u.value))
  try {
    if (immediate.length > 0) {
      await updatePageProperties(notion.apiToken, opts.page.id, immediate, ctx)
    }
  } catch (err) {
    rt.state.lastError = `pickup-updates failed for ${opts.page.id}: ${err instanceof Error ? err.message : String(err)}`
    saveAndEmit(rt)
    return null
  }

  // Cross-feature guard: tell the classic notion poller this page is claimed.
  addPickedUp(rt.config.projectId, [opts.page.id])

  const pipeline: FoundryPipeline = {
    id: `pipe-${rt.config.id}-${opts.page.id.slice(0, 8)}-${Date.now().toString(36)}`,
    foundryId: rt.config.id,
    page: opts.page,
    phase: 'spawn-requested',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    log: [`Pipeline started — ${opts.reason}`],
    baseBranch: rt.config.baseBranch,
  }
  rt.state.pipelines.push(pipeline)
  saveAndEmit(rt)

  const payload: FoundryFireTaskPayload = {
    foundryId: rt.config.id,
    pipelineId: pipeline.id,
    projectId: rt.config.projectId,
    page: opts.page,
    resolvedImplementPrompt,
    suggestedBranchName,
    suggestedSessionName,
    baseBranch: rt.config.baseBranch,
    workerPermissionMode: rt.config.workerPermissionMode,
  }
  fireWorkerSpawn(rt, pipeline, payload)
  return pipeline
}

function fireWorkerSpawn(rt: FoundryRuntime, pipeline: FoundryPipeline, payload: FoundryFireTaskPayload): void {
  const win = mainWindow
  if (!win || win.isDestroyed()) return
  const prior = rt.pipelineAcks.get(pipeline.id)
  const fired = (prior?.fired ?? 0) + 1
  if (prior?.timer) clearTimeout(prior.timer)
  const timer = setTimeout(() => {
    const pp = rt.state.pipelines.find((x) => x.id === pipeline.id)
    if (!pp || pp.phase !== 'spawn-requested') return
    if (fired >= ACK_REFIRE_MAX) {
      pp.attention = { reason: 'worker-spawn ack never arrived', since: new Date().toISOString() }
      log(pp, `Worker spawn never acked after ${ACK_REFIRE_MAX} attempts.`)
      saveAndEmit(rt)
      rt.pipelineAcks.delete(pipeline.id)
      return
    }
    fireWorkerSpawn(rt, pp, payload)
  }, ACK_TIMEOUT_MS)
  rt.pipelineAcks.set(pipeline.id, { fired, timer })
  emitToRenderer(win, IPC.FOUNDRY_FIRE_TASK, payload)
}

/**
 * The default text we put in the implementCommandTemplate field of a freshly
 * created foundry. Surfaced as-is in the UI textarea so the user sees exactly
 * what gets sent to the worker — no hidden post-processing.
 */
export const DEFAULT_IMPLEMENT_COMMAND_TEMPLATE = `/notion-ticket {{taskUrl}}

When the ticket is fully implemented:
1. Stage and commit all your changes with a clear message.
2. Push the branch to origin.
3. Open a DRAFT pull request against the base branch. The PR title should summarise the ticket; the PR body should include the Notion ticket URL and a short summary of what you changed.
4. Do not mark the PR ready for review yet, and do not update the Notion ticket status — the Foundry handles both once a separate review loop has converged.

If you are blocked or need a decision, say so clearly and stop without pushing.`

export const DEFAULT_READY_FOR_REVIEW_COMMAND_TEMPLATE = `Update the PR review checklist. Use ✓, ✗, and ⊘ — use ⊘ where the question is not applicable or we haven't touched that area. Add a short note only if absolutely necessary; otherwise leave blank. Note that we have reviewed with Claude Code, then mark the PR as ready for review.`

async function applyDeferredPickupUpdates(rt: FoundryRuntime, p: FoundryPipeline): Promise<void> {
  const notion = notionAccess(rt.config)
  if (!notion) return
  const ctx = {
    ...buildPlaceholderContext(p.page),
    branch: p.branch ?? '',
    sessionId: p.sessionId ?? '',
  }
  const deferred = (rt.config.pickupUpdates ?? []).filter((u) => valueReferencesSession(u.value))
  if (deferred.length > 0) {
    await updatePageProperties(notion.apiToken, p.page.id, deferred, ctx)
  }
}

// ── PR polling (the only thing we watch during 'implementing') ──────────────

const BRACKETED_PASTE_START = '\x1b[200~'
const BRACKETED_PASTE_END = '\x1b[201~'
const READY_TIMEOUT_MS = 15 * 60_000
const BRACKETED_PASTE_DELAY_MS = 250
/** How much the PTY buffer must grow for us to count this stop as "real". */
const MIN_RESPONSE_GROWTH_BYTES = 200

/**
 * Type the prompt into the PTY (bracketed-paste mode so claude's TUI treats
 * the whole multi-line block as one paste rather than a sequence of
 * keystrokes), wait a beat for it to render, then send the submit CR.
 * Then wait for a stop hook event AND require the PTY's rolling buffer to
 * have grown by at least MIN_RESPONSE_GROWTH_BYTES — that's how we
 * distinguish a real worker response from a stale stop event (the previous
 * turn's stop hook landing late, the auto-restart synthetic stop, etc.).
 *
 * Returns true on a verified response, false on timeout/stale.
 */
async function injectAndAwaitResponse(
  terminalId: string,
  contextId: string,
  prompt: string
): Promise<boolean> {
  const bufferBefore = getTerminalBuffer(terminalId).length
  const normalised = prompt.replace(/\r\n/g, '\n')
  writeTerminal(terminalId, `${BRACKETED_PASTE_START}${normalised}${BRACKETED_PASTE_END}`)
  await new Promise((r) => setTimeout(r, BRACKETED_PASTE_DELAY_MS))
  writeTerminal(terminalId, '\r')

  // Keep listening for stop events until either we see a "real" one (buffer
  // grew meaningfully → claude actually produced output) or we run out of
  // time. Stale events are ignored, not consumed.
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now()
    const ok = await waitForSessionStop(contextId, remaining)
    if (!ok) return false
    const growth = getTerminalBuffer(terminalId).length - bufferBefore
    if (growth >= MIN_RESPONSE_GROWTH_BYTES) return true
    // Stale-looking stop — log and keep waiting.
    console.log(
      `[foundry] ignoring stale stop on ${contextId.slice(0, 8)}… (PTY buffer grew only ${growth} bytes)`
    )
  }
  return false
}

/**
 * Re-fetches the PR from GitHub and returns true if it's no longer a draft.
 * Caller uses this AFTER injecting the user's ready-for-review prompt — if
 * the worker did its job the PR should be ready; if it's still draft, we
 * surface attention rather than overriding the user.
 */
async function verifyPRReady(worktreePath: string, prNumber: number): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      'gh',
      ['pr', 'view', String(prNumber), '--json', 'isDraft'],
      { cwd: worktreePath }
    )
    const parsed = JSON.parse(stdout) as { isDraft?: boolean }
    return parsed.isDraft === false
  } catch (err) {
    console.error(`[foundry] verifyPRReady failed for PR #${prNumber}`, err)
    return false
  }
}

/**
 * Resolves true the next time the given contextId emits a 'stop' hook event,
 * or false on timeout. Used by runFinalizePhase to know when the worker
 * finished the injected ready-for-review prompt.
 */
function waitForSessionStop(contextId: string, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false
    const listener = (cid: string, _tabId: string, hookType: string): void => {
      if (settled) return
      if (cid !== contextId || hookType !== 'stop') return
      settled = true
      eventBus.off(IPC.NOTIFICATION_SESSION_STATUS, listener)
      clearTimeout(timer)
      resolve(true)
    }
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      eventBus.off(IPC.NOTIFICATION_SESSION_STATUS, listener)
      resolve(false)
    }, timeoutMs)
    eventBus.on(IPC.NOTIFICATION_SESSION_STATUS, listener)
  })
}

async function onSessionHookEvent(contextId: string, _hookType: string): Promise<void> {
  // Stop hooks fire roughly when the worker says it's done with a turn — a
  // good moment to opportunistically check for the PR (the worker should
  // have pushed + opened it by now). PR polling will catch it anyway if the
  // hook is dropped, but checking here gives near-instant advancement.
  for (const rt of runtimes.values()) {
    const p = rt.state.pipelines.find((pp) => pp.sessionId === contextId && pp.phase === 'implementing')
    if (p) {
      void checkPRForPipeline(rt, p)
      return
    }
  }
}

async function pollForPRs(rt: FoundryRuntime): Promise<void> {
  const timeoutMin = rt.config.implementTimeoutMinutes ?? DEFAULT_IMPLEMENT_TIMEOUT_MIN
  const now = Date.now()
  for (const p of rt.state.pipelines) {
    if (p.phase !== 'implementing') continue
    const startedMs = Date.parse(p.startedAt)
    if (Number.isFinite(startedMs) && now - startedMs > timeoutMin * 60_000 && !p.attention) {
      // No PR after the configured timeout — flag for human attention. The
      // poll keeps running, so if the worker DOES eventually open the PR
      // we'll still advance.
      p.attention = {
        reason: `no PR after ${timeoutMin}m — worker may be stuck`,
        since: new Date().toISOString(),
      }
      log(p, `PR-poll timeout after ${timeoutMin}m without a PR.`)
      saveAndEmit(rt)
    }
    void checkPRForPipeline(rt, p)
  }
}

async function checkPRForPipeline(rt: FoundryRuntime, p: FoundryPipeline): Promise<void> {
  if (rt.advancing.has(p.id)) return
  if (p.phase !== 'implementing' || !p.worktreePath || !p.branch) return
  rt.advancing.add(p.id)
  try {
    const info = await findPRForBranch(p.worktreePath, p.branch)
    if (!info) return
    // Re-check phase after the await.
    const fresh = rt.state.pipelines.find((pp) => pp.id === p.id)
    if (!fresh || fresh.phase !== 'implementing') return
    fresh.prNumber = info.number
    fresh.prUrl = info.url
    fresh.attention = undefined
    log(fresh, `Draft PR #${info.number} detected — starting review loop.`)
    saveAndEmit(rt)
    await runReviewPhase(rt, fresh)
  } finally {
    rt.advancing.delete(p.id)
  }
}

async function runReviewPhase(rt: FoundryRuntime, p: FoundryPipeline): Promise<void> {
  if (!p.worktreePath || !p.branch || !p.sessionId || !p.prNumber) return
  p.phase = 'reviewing'
  saveAndEmit(rt)
  const baseBranch = p.baseBranch ?? rt.config.baseBranch ?? 'main'
  const cfg = {
    enabled: true,
    variant: 'lite' as const,
    maxIterations: rt.config.reviewLoopOverride?.maxIterations ?? 5,
    consecutiveCleanRounds: rt.config.reviewLoopOverride?.consecutiveCleanRounds ?? 2,
    costCapUsd: rt.config.reviewLoopOverride?.costCapUsd ?? 5,
  }
  try {
    await startReviewLoopLite({
      sessionId: p.sessionId,
      worktreePath: p.worktreePath,
      branch: p.branch,
      baseBranch,
      config: cfg,
      prNumber: p.prNumber,
    })
    log(p, `Review loop started for PR #${p.prNumber}.`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    p.attention = { reason: `review-loop start failed: ${msg}`, since: new Date().toISOString() }
    log(p, `Review-loop start failed: ${msg}`)
    saveAndEmit(rt)
  }
}

async function onReviewLoopUpdate(state: ReviewLoopState): Promise<void> {
  if (state.status === 'running') return
  for (const rt of runtimes.values()) {
    const p = rt.state.pipelines.find((pp) => pp.sessionId === state.sessionId && pp.phase === 'reviewing')
    if (!p) continue
    const proceed =
      state.status === 'completed' ||
      (rt.config.onReviewNonConvergence === 'proceed' && state.status !== 'cancelled')
    if (proceed) {
      log(p, `Review loop ${state.status} (${state.stopReason ?? 'no-reason'}) — finalizing.`)
      await runFinalizePhase(rt, p)
    } else {
      p.attention = { reason: `review-loop ${state.status} (${state.stopReason ?? '?'})`, since: new Date().toISOString() }
      log(p, `Review loop ended without converging — attention required.`)
      saveAndEmit(rt)
    }
  }
}

async function runFinalizePhase(rt: FoundryRuntime, p: FoundryPipeline): Promise<void> {
  if (!p.prNumber || !p.worktreePath) return
  p.phase = 'finalizing'
  saveAndEmit(rt)
  try {
    // Inject the ready-for-review command into the WORKER's existing PTY
    // (the same claude session that did the implement). The user can watch
    // it run and type ad-hoc feedback. We then trust their prompt to do
    // the actual PR + Notion bits — our code only verifies after.
    const tpl = rt.config.readyForReviewCommandTemplate?.trim()
    let workerRan = false
    if (tpl && p.sessionId) {
      const ctx = {
        ...buildPlaceholderContext(p.page),
        branch: p.branch ?? '',
        sessionId: p.sessionId ?? '',
        prUrl: p.prUrl ?? '',
        prNumber: String(p.prNumber),
      }
      const cmd = resolvePlaceholders(tpl, ctx)
      const terminals = listTerminalsForSession(p.sessionId)
      const agentTerminal = terminals.find((t) => t.tabId === 'agent')
      if (!agentTerminal) {
        p.attention = {
          reason: 'worker session terminal is gone — cannot inject ready-for-review command',
          since: new Date().toISOString(),
        }
        log(p, `Ready-for-review: no live agent terminal for session ${p.sessionId}.`)
        saveAndEmit(rt)
        return
      }
      log(p, `Injecting ready-for-review command into session ${p.sessionId.slice(0, 8)}…`)
      saveAndEmit(rt)
      workerRan = await injectAndAwaitResponse(agentTerminal.terminalId, p.sessionId, cmd)
      if (!workerRan) {
        p.attention = {
          reason: 'ready-for-review command never produced a worker response (timeout or stale stop event)',
          since: new Date().toISOString(),
        }
        log(p, 'Ready-for-review: no verified worker response.')
        saveAndEmit(rt)
        return
      }
      log(p, 'Ready-for-review command finished.')
    } else if (tpl) {
      log(p, 'Ready-for-review skipped — no worker session id on pipeline.')
    }

    // Trust the user's prompt as the source of truth when one is set: only
    // VERIFY the PR is ready, don't force it ourselves. If the prompt didn't
    // mark it ready, that's the user's call to make and the foundry surfaces
    // it as attention rather than silently overriding. With no prompt
    // configured we keep the auto-mark behaviour so default autopilot still
    // works.
    if (tpl) {
      const verifiedReady = await verifyPRReady(p.worktreePath, p.prNumber)
      if (!verifiedReady) {
        p.attention = {
          reason: `ready-for-review prompt finished but PR #${p.prNumber} is still a draft — your prompt didn't mark it ready`,
          since: new Date().toISOString(),
        }
        log(p, `PR #${p.prNumber} is still draft after ready-for-review prompt — attention.`)
        saveAndEmit(rt)
        return
      }
      log(p, `PR #${p.prNumber} confirmed ready-for-review (worker handled it).`)
    } else {
      await markPRReady(p.worktreePath, p.prNumber)
      log(p, `PR #${p.prNumber} marked ready-for-review.`)
    }
    const notion = notionAccess(rt.config)
    if (notion) {
      const ctx = {
        ...buildPlaceholderContext(p.page),
        branch: p.branch ?? '',
        sessionId: p.sessionId ?? '',
        prUrl: p.prUrl ?? '',
        prNumber: String(p.prNumber),
      }
      try {
        if ((rt.config.readyForReviewUpdates ?? []).length > 0) {
          await updatePageProperties(
            notion.apiToken,
            p.page.id,
            rt.config.readyForReviewUpdates,
            ctx
          )
        }
      } catch (err) {
        log(p, `Notion ready-updates failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    p.phase = 'done'
    log(p, 'Pipeline complete.')
    saveAndEmit(rt)
    // Free slot → maybe foreman picks up next task.
    requestPass(rt, 'slot-freed', false)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    p.attention = { reason: `finalize failed: ${msg}`, since: new Date().toISOString() }
    log(p, `Finalize failed: ${msg}`)
    saveAndEmit(rt)
  }
}

// ── Pipeline retry / skip actions ───────────────────────────────────────────

async function retryPhase(rt: FoundryRuntime, p: FoundryPipeline): Promise<void> {
  p.attention = undefined
  switch (p.phase) {
    case 'reviewing':
      return runReviewPhase(rt, p)
    case 'finalizing':
      return runFinalizePhase(rt, p)
    case 'implementing':
      // Force an immediate PR check + reset the start time so the
      // implement-timeout watchdog gives the worker another window.
      p.startedAt = new Date().toISOString()
      saveAndEmit(rt)
      return checkPRForPipeline(rt, p)
    default:
      log(p, `No retry handler for phase ${p.phase}.`)
      saveAndEmit(rt)
  }
}

async function skipPhase(rt: FoundryRuntime, p: FoundryPipeline): Promise<void> {
  p.attention = undefined
  // Skip = jump to finalize. Useful when review-loop wedged or PR ready by hand.
  log(p, `Skipping phase ${p.phase} → finalizing.`)
  await runFinalizePhase(rt, p)
}

// ── Rehydration ─────────────────────────────────────────────────────────────

function rehydrateAfterStartup(rt: FoundryRuntime): void {
  // Make sure the configured base branch is reachable before we re-fire any
  // worker spawns — otherwise the renderer's worktree.create would ENOENT
  // and the pipeline would re-fire on every restart into the same error.
  if (rt.config.baseBranch?.trim()) {
    const repoPath = projectRepoPath(rt.config.projectId)
    if (repoPath) {
      void ensureBaseBranchExists(repoPath, rt.config.baseBranch.trim()).catch((err) => {
        rt.state.lastError = `rehydrate: base branch "${rt.config.baseBranch}" could not be ensured: ${err instanceof Error ? err.message : String(err)}`
        console.error(`[foundry:${rt.config.id}] ${rt.state.lastError}`)
        saveAndEmit(rt)
      })
    }
  }
  for (const p of rt.state.pipelines) {
    switch (p.phase) {
      case 'spawn-requested': {
        log(p, 'Re-firing worker spawn after app start.')
        // Reissue fire-task with the same payload shape (no longer have the
        // resolved prompt though — rebuild from config).
        const ctx = buildPlaceholderContext(p.page)
        const resolvedImplementPrompt =
          resolvePlaceholders(rt.config.implementCommandTemplate, ctx)
        const branchTemplate = rt.config.branchNameTemplate ?? 'foundry/{{taskTitleSlug}}'
        const suggestedBranchName = resolvePlaceholders(branchTemplate, ctx) || `foundry/${p.page.id.slice(0, 8)}`
        const suggestedSessionName = p.page.title ? slugify(p.page.title) || `foundry-${p.page.id.slice(0, 8)}` : `foundry-${p.page.id.slice(0, 8)}`
        const payload: FoundryFireTaskPayload = {
          foundryId: rt.config.id,
          pipelineId: p.id,
          projectId: rt.config.projectId,
          page: p.page,
          resolvedImplementPrompt,
          suggestedBranchName,
          suggestedSessionName,
          baseBranch: rt.config.baseBranch,
          workerPermissionMode: rt.config.workerPermissionMode,
        }
        fireWorkerSpawn(rt, p, payload)
        break
      }
      case 'implementing':
        // PR poller will pick up where we left off.
        break
      case 'reviewing':
        // Review-loop state is in-memory; restart it.
        void runReviewPhase(rt, p)
        break
      case 'finalizing':
        void runFinalizePhase(rt, p)
        break
      default:
        break
    }
  }
  if (rt.state.passInFlight) {
    rt.state.passInFlight = false
    if (rt.state.passes.length > 0) {
      const last = rt.state.passes[rt.state.passes.length - 1]
      if (last.status === 'running') {
        last.status = 'aborted'
        last.endedAt = new Date().toISOString()
      }
    }
  }
  saveAndEmit(rt)
}

// ── Helpers ─────────────────────────────────────────────────────────────────

interface ProjectsStoreShape {
  projects: Array<{ id: string; repoPath: string }>
}

function projectRepoPath(projectId: string): string | null {
  try {
    // Match project.ipc.ts — no `name`, so it reads from electron-store's
    // default `config.json` (where the project IPC handler persists them).
    const fresh = new Store<ProjectsStoreShape>({
      cwd: getStorePath(),
      defaults: { projects: [] },
    })
    const proj = fresh.get('projects', []).find((p) => p.id === projectId)
    return proj?.repoPath ?? null
  } catch {
    return null
  }
}

/**
 * Make sure the configured base branch exists somewhere git can branch off it.
 *
 * Order of attempts:
 *   1. Already on origin (best case — fetch + done).
 *   2. Exists locally only — push to origin so future fetches see it.
 *   3. Doesn't exist anywhere — create off `origin/<defaultBranch>` and push.
 *
 * Throws if every attempt fails (e.g. no remote, no default branch). The
 * caller surfaces this as a pipeline-level attention so the user knows
 * the foundry can't run until they fix the base.
 */
export async function ensureBaseBranchExists(repoPath: string, baseBranch: string): Promise<void> {
  // 1) On origin already?
  try {
    await execFileAsync('git', ['fetch', 'origin', baseBranch], { cwd: repoPath })
    return
  } catch {
    // not on origin
  }
  // 2) Local only?
  try {
    await execFileAsync('git', ['rev-parse', '--verify', `refs/heads/${baseBranch}`], { cwd: repoPath })
    // Push it so subsequent fetches succeed.
    await execFileAsync('git', ['push', '-u', 'origin', baseBranch], { cwd: repoPath })
    return
  } catch {
    // not local either
  }
  // 3) Create from the repo default.
  const defaultBranch = await getDefaultBranch(repoPath)
  if (!defaultBranch) {
    throw new Error('cannot determine repo default branch')
  }
  // Fetch the default first so we branch off the latest origin tip.
  try {
    await execFileAsync('git', ['fetch', 'origin', defaultBranch], { cwd: repoPath })
  } catch {
    // Best-effort — keep going against local refs.
  }
  // Create the branch ref. Prefer origin/<default>; fall back to local <default>.
  let startPoint = `origin/${defaultBranch}`
  try {
    await execFileAsync('git', ['rev-parse', '--verify', `refs/remotes/origin/${defaultBranch}`], { cwd: repoPath })
  } catch {
    startPoint = defaultBranch
  }
  await execFileAsync('git', ['branch', baseBranch, startPoint], { cwd: repoPath })
  // Push to origin so workers (and other tooling) can use it.
  await execFileAsync('git', ['push', '-u', 'origin', baseBranch], { cwd: repoPath })
}

function notionAccess(cfg: FoundryConfig): { apiToken: string; databaseId: string; titlePropertyName?: string } | null {
  const override = cfg.notionOverride
  const base = loadNotionConfig(cfg.projectId)
  const apiToken = override?.apiToken ?? base?.apiToken
  const databaseId = override?.databaseId ?? base?.databaseId
  if (!apiToken || !databaseId) return null
  const titlePropertyName = override?.titlePropertyName ?? base?.titlePropertyName
  return { apiToken, databaseId, titlePropertyName }
}

function buildPlaceholderContext(page: NotionTaskPayload): {
  taskId: string
  taskUrl: string
  taskTitle: string
  taskTitleSlug: string
} {
  return {
    taskId: page.id,
    taskUrl: page.url,
    taskTitle: page.title,
    taskTitleSlug: slugify(page.title || page.id),
  }
}

function valueReferencesSession(value: string): boolean {
  return /\{\{(branch|sessionId|prUrl|prNumber)\}\}/.test(value)
}

export function countActivePipelines(rt: FoundryRuntime): number {
  // Pipelines flagged for attention still occupy a slot — they're in-flight,
  // just waiting on a human. Only terminal phases free the slot.
  return rt.state.pipelines.filter((p) => !isTerminal(p.phase)).length
}

function isTerminal(phase: FoundryPipelinePhase): boolean {
  return phase === 'done' || phase === 'cancelled' || phase === 'orphaned'
}

function log(p: FoundryPipeline, message: string): void {
  p.log.push(`[${new Date().toISOString()}] ${message}`)
  p.updatedAt = new Date().toISOString()
}

// ── State bounding ───────────────────────────────────────────────────────────
// The runtime state is append-only by nature (every pass, pipeline, transcript
// line and log line is pushed and never removed). Left unbounded it grows
// without limit, and because the whole state is persisted to disk AND sent to
// the renderer on every mutation, an unbounded state is also re-serialized in
// full on every tick. Cap each growing collection so memory and IPC payloads
// stay flat over a long autopilot run.
const MAX_PASSES = 50
const MAX_PASS_TRANSCRIPT_LINES = 2000
const MAX_TERMINAL_PIPELINES = 50
const MAX_PIPELINE_LOG_LINES = 500

export function pruneState(state: FoundryRuntimeState): void {
  if (state.passes.length > MAX_PASSES) {
    state.passes.splice(0, state.passes.length - MAX_PASSES)
  }
  for (const pass of state.passes) {
    if (pass.transcript.length > MAX_PASS_TRANSCRIPT_LINES) {
      pass.transcript.splice(0, pass.transcript.length - MAX_PASS_TRANSCRIPT_LINES)
    }
  }
  for (const pipeline of state.pipelines) {
    if (pipeline.log.length > MAX_PIPELINE_LOG_LINES) {
      pipeline.log.splice(0, pipeline.log.length - MAX_PIPELINE_LOG_LINES)
    }
  }
  // Keep every still-active pipeline plus the most-recently-updated terminal
  // ones; drop the oldest terminal pipelines beyond the cap.
  const terminal = state.pipelines.filter((p) => isTerminal(p.phase))
  if (terminal.length > MAX_TERMINAL_PIPELINES) {
    const drop = new Set(
      [...terminal]
        .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
        .slice(0, terminal.length - MAX_TERMINAL_PIPELINES)
        .map((p) => p.id)
    )
    state.pipelines = state.pipelines.filter((p) => !drop.has(p.id))
  }
}

function saveState(rt: FoundryRuntime): void {
  pruneState(rt.state)
  const all = stateStore.get('states', {})
  all[rt.config.id] = rt.state
  stateStore.set('states', all)
}

function saveAndEmit(rt: FoundryRuntime): void {
  saveState(rt)
  if (mainWindow && !mainWindow.isDestroyed()) {
    // No structuredClone here: `emitToRenderer` → `webContents.send` already
    // structured-clones the payload during IPC serialization, and no consumer
    // mutates the state. The previous explicit clone duplicated the entire
    // (growing) state on every emit — a major source of allocation churn.
    emitToRenderer(mainWindow, IPC.FOUNDRY_STATE_UPDATE, rt.config.id, rt.state)
  }
}

// Exposed for foreman service.
export function getRuntime(foundryId: string): FoundryRuntime | undefined {
  return runtimes.get(foundryId)
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

/** Flush in-memory runtime state to disk and emit the FOUNDRY_STATE_UPDATE event. */
export function flushState(foundryId: string): void {
  const rt = runtimes.get(foundryId)
  if (!rt) return
  saveAndEmit(rt)
}

export function notionAccessFor(cfg: FoundryConfig): {
  apiToken: string
  databaseId: string
  titlePropertyName?: string
} | null {
  return notionAccess(cfg)
}

export type FoundryRuntimeRef = FoundryRuntime

// Exposed for tests.
export function _resetForTests(): void {
  for (const rt of runtimes.values()) teardownRuntime(rt)
  runtimes.clear()
  if (unsubReviewLoop) unsubReviewLoop()
  if (unsubSessionStatus) unsubSessionStatus()
  unsubReviewLoop = null
  unsubSessionStatus = null
  mainWindow = null
  started = false
  runForemanPass = null
}

// Best-effort comment writer used by the foreman pass to document plans.
export async function tryAppendTicketMarkdown(
  cfg: FoundryConfig,
  pageId: string,
  markdown: string
): Promise<void> {
  const notion = notionAccess(cfg)
  if (!notion) return
  try {
    await appendMarkdownBlocks(notion.apiToken, pageId, markdown, {})
  } catch (err) {
    console.error(`[foundry] append markdown failed for ${pageId}`, err)
  }
}
