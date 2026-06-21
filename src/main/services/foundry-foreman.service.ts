/**
 * Foundry Foreman — autopilot brain.
 *
 * One "pass" = one headless claude run that reads context.json (current tasks,
 * statuses, ticket bodies, running pipelines, free slots) and writes
 * decision.json naming 0..N tasks to start + plan markdown to append. The
 * deterministic foundry.service validates the decision and executes it.
 */
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { existsSync, watch as fsWatch } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { spawnTerminal, killTerminal, getTerminalBuffer } from './terminal.service'
import { getMainWindow } from './foundry.service'
import type {
  ForemanDecision,
  FoundryConfig,
  FoundryPassRecord,
  FoundryPassTrigger,
  NotionTaskPayload,
} from '../../shared/types'
import { getStorePath } from '../store-path'
import {
  getPageBodyMarkdown,
  queryDatabase,
} from './notion.service'
import Store from 'electron-store'
import {
  countActivePipelines,
  flushState,
  getRuntime,
  notionAccessFor,
  registerForemanRunner,
  startPipeline,
  tryAppendTicketMarkdown,
  type FoundryRuntimeRef,
} from './foundry.service'
import { loadConfig as loadNotionConfig } from './notion-poller.service'
import { resolveOptimisticStatuses } from '../../shared/foundry'

const PASS_TIMEOUT_MS = 15 * 60 * 1000

let installed = false

export function installForeman(): void {
  if (installed) return
  installed = true
  registerForemanRunner(async ({ foundryId, trigger }) => {
    await runPass(foundryId, trigger)
  })
}

interface BuildContextResult {
  context: ForemanContext
  pages: NotionTaskPayload[]
}

interface ForemanContext {
  foundry: { id: string; name: string }
  freeSlots: number
  completionTransition: FoundryConfig['completionTransition']
  completedStatuses: string[]
  /** On when optimistic-continue is enabled — changes eligibility + merge rules. */
  optimisticContinue: boolean
  /** Statuses meaning "PR open, not yet on trunk" (only when optimisticContinue). */
  optimisticStatuses: string[]
  runningPipelines: Array<{ pageId: string; phase: string; branch?: string }>
  tasks: Array<{
    pageId: string
    title: string
    url: string
    status: string
    body: string
  }>
}

export async function buildPassContext(foundryId: string): Promise<BuildContextResult | null> {
  const rt = getRuntime(foundryId)
  if (!rt) return null
  const cfg = rt.config
  const notion = getNotion(cfg)
  if (!notion) return null
  const pages = await queryDatabase(
    notion.apiToken,
    notion.databaseId,
    cfg.taskSetFilters,
    notion.titlePropertyName
  )
  const statusProp = cfg.completionTransition.property
  const tasks: ForemanContext['tasks'] = []
  for (const p of pages) {
    const status = extractStatusLike(p.rawProperties, statusProp)
    let body = ''
    try {
      body = await getPageBodyMarkdown(notion.apiToken, p.id)
    } catch {
      body = '(failed to read body)'
    }
    tasks.push({ pageId: p.id, title: p.title, url: p.url, status, body })
  }
  const runningPipelines = rt.state.pipelines
    .filter((pp) => pp.phase !== 'done' && pp.phase !== 'cancelled' && pp.phase !== 'orphaned')
    .map((pp) => ({ pageId: pp.page.id, phase: pp.phase, branch: pp.branch }))
  const freeSlots = Math.max(
    0,
    (cfg.maxConcurrentTasks ?? 2) - countActivePipelines(rt)
  )
  return {
    pages,
    context: {
      foundry: { id: cfg.id, name: cfg.name },
      freeSlots,
      completionTransition: cfg.completionTransition,
      completedStatuses: cfg.completedStatuses ?? [],
      optimisticContinue: cfg.optimisticContinue === true,
      optimisticStatuses: resolveOptimisticStatuses(cfg),
      runningPipelines,
      tasks,
    },
  }
}

export function buildPassPrompt(
  contextPath: string,
  decisionPath: string,
  ctx: ForemanContext,
  opts: { passIndex: number; isFirstPass: boolean } = { passIndex: 1, isFirstPass: true }
): string {
  const continuation = opts.isFirstPass
    ? ''
    : `

This is pass #${opts.passIndex}. You have memory of previous passes — refer back to what you decided, what you said was blocked, and why. If you previously claimed a dependency, verify whether it's now resolved (the context will show updated statuses).`
  const optimisticInput = ctx.optimisticContinue
    ? `
- optimisticContinue: TRUE — see "Optimistic continue" below
- optimisticStatuses: ${JSON.stringify(ctx.optimisticStatuses)} — statuses meaning "PR open, not yet merged to trunk"`
    : ''
  const optimisticSection = ctx.optimisticContinue
    ? `

## Optimistic continue (ENABLED)

This foundry is running in optimistic mode. A dependency counts as satisfied not
only when it is in completedStatuses (merged to trunk) but ALSO when it is in one
of optimisticStatuses (${JSON.stringify(ctx.optimisticStatuses)}) — i.e. it has an
open PR we optimistically assume will be approved.

When you start a task, look at each of its dependencies:
- Dependency in completedStatuses → its code is already on trunk; nothing to do.
- Dependency whose current status is in optimisticStatuses → its code is NOT on
  trunk yet; it lives only in that PR's branch. List that dependency's pageId in
  the started task's \`optimisticDependsOn\` array so the foundry merges the PR
  branch into this task before work begins.
- A task is only eligible if EVERY dependency is in completedStatuses OR
  optimisticStatuses. If any dependency is in neither, leave it blocked.

Only include a pageId in \`optimisticDependsOn\` if that dependency's status is
currently in optimisticStatuses. Never list a completedStatuses dependency there.`
    : ''
  return `You are the Foundry Foreman for "${ctx.foundry.name}". Your job: pick which Notion tasks to start *next* on autopilot. You DO NOT write code, modify files, or run anything beyond reading "${contextPath}" and writing "${decisionPath}".${continuation}

## Inputs

A JSON context at "${contextPath}" describes the task set:
- foundry: identity
- freeSlots: how many tasks you may start this pass (0 is valid — see below)
- completionTransition: the status move that signals a task is verified complete
- completedStatuses: statuses that mean a task is "dependency-satisfied"
- runningPipelines: tasks already in-flight (do NOT re-start these)
- tasks: { pageId, title, url, status, body } for every task in the set${optimisticInput}${optimisticSection}

## Job

1. Read "${contextPath}".
2. Infer ordering and dependencies between tasks. If the workspace has an explicit dependency relation visible in the bodies, prefer that. Otherwise reason from the ticket text and the codebase.
3. Decide up to \`freeSlots\` tasks to start NOW. Choose tasks that are:
   - Not already in runningPipelines.
   - Eligible to start (their dependencies are satisfied — any "depends on" task is in completedStatuses or is irrelevant; their status matches the foundry's pickup criteria).
   - Non-conflicting with each other (independent files/areas where possible).
   For each task you decide to start, pick a branch name and a short session name. Use a CONVENTIONAL prefix:
     - \`feat/<slug>\` for new functionality (most common — additive features, new endpoints, new UI).
     - \`fix/<slug>\` for bug fixes / regressions.
     - \`refactor/<slug>\` for code reorganisation that changes no external behaviour.
     - \`chore/<slug>\` for non-feature housekeeping (deps, infra, build).
     - \`docs/<slug>\` for documentation-only.
   The slug is short kebab-case (4–6 words max) describing the unit of work — e.g. \`feat/attempts-table\`, \`fix/null-row-skip\`. Do NOT just slugify the ticket title; pick something tighter that reads like a real human-named branch. The session name should be the same slug WITHOUT the prefix (e.g. \`attempts-table\`).
4. For tasks where you reached a meaningful judgement (planning notes, dependency declarations), include a \`ticketNotes\` entry. Only emit notes you have NOT documented before (the foundry deduplicates on content hash, but you should still avoid noise).
5. Starting ZERO tasks is a valid outcome — say so in \`summary\`. Do not start tasks that aren't eligible just to fill slots.

## Output

Write a single JSON object to "${decisionPath}":

\`\`\`json
{
  "planMarkdown": "optional global plan, markdown",
  "ticketNotes": [
    { "pageId": "<page-id>", "comment": "**Foundry plan** — short reasoning. Dependencies: ...", "dependsOn": ["<page-id>"] }
  ],
  "start": [
    {
      "pageId": "<page-id>",
      "reason": "why this one, now",
      "branchName": "feat/<slug>",
      "sessionName": "<slug>"${ctx.optimisticContinue ? ',\n      "optimisticDependsOn": ["<dep-page-id-in-optimisticStatuses>"]' : ''}
    }
  ],
  "blocked": [
    { "pageId": "<page-id>", "reason": "what it's waiting on" }
  ],
  "summary": "one-sentence summary of this pass"
}
\`\`\`

Rules:
- Output a single valid JSON object, no markdown wrapper.
- start: include AT MOST \`freeSlots\` entries.
- Each \`comment\` MUST start with "**Foundry plan** —" so reviewers can spot it on the ticket.
- Never include a pageId that's already in runningPipelines under \`start\`.
- Be conservative — when in doubt, leave the task in \`blocked\` and explain.
- Write the file before exiting.`
}

export interface ValidationResult {
  applied: ForemanDecision
  warnings: string[]
}

export function validateDecision(
  raw: unknown,
  ctx: ForemanContext,
  documentedHashes: Record<string, string>
): ValidationResult {
  const warnings: string[] = []
  if (!raw || typeof raw !== 'object') {
    throw new Error('decision must be an object')
  }
  const r = raw as Record<string, unknown>
  const start = Array.isArray(r.start) ? r.start : []
  const blocked = Array.isArray(r.blocked) ? r.blocked : []
  const ticketNotes = Array.isArray(r.ticketNotes) ? r.ticketNotes : []
  const summary = typeof r.summary === 'string' ? r.summary : ''
  const planMarkdown = typeof r.planMarkdown === 'string' ? r.planMarkdown : undefined

  const validPageIds = new Set(ctx.tasks.map((t) => t.pageId))
  const runningSet = new Set(ctx.runningPipelines.map((p) => p.pageId))

  const filteredStart: ForemanDecision['start'] = []
  for (const s of start) {
    if (!s || typeof s !== 'object') continue
    const obj = s as Record<string, unknown>
    const pageId = String(obj.pageId ?? '')
    const reason = String(obj.reason ?? '')
    if (!validPageIds.has(pageId)) {
      warnings.push(`drop start: pageId not in task set — ${pageId}`)
      continue
    }
    if (runningSet.has(pageId)) {
      warnings.push(`drop start: page already running — ${pageId}`)
      continue
    }
    if (filteredStart.length >= ctx.freeSlots) {
      warnings.push(`drop start: exceeds freeSlots (${ctx.freeSlots}) — ${pageId}`)
      continue
    }
    const rawBranch = typeof obj.branchName === 'string' ? obj.branchName.trim() : ''
    const rawSession = typeof obj.sessionName === 'string' ? obj.sessionName.trim() : ''
    const branchName = sanitizeBranchName(rawBranch)
    const sessionName = sanitizeSlug(rawSession) || (branchName ? branchName.split('/').pop() : '')
    if (rawBranch && !branchName) {
      warnings.push(`drop branchName: invalid format — ${rawBranch}`)
    }
    // Optimistic deps are only honored when the foundry is in optimistic mode;
    // filter to known pageIds and drop self-references.
    let optimisticDependsOn: string[] | undefined
    if (ctx.optimisticContinue && Array.isArray(obj.optimisticDependsOn)) {
      const deps = obj.optimisticDependsOn
        .map(String)
        .filter((id) => id !== pageId && validPageIds.has(id))
      if (deps.length > 0) optimisticDependsOn = Array.from(new Set(deps))
    }
    filteredStart.push({
      pageId,
      reason,
      branchName: branchName || undefined,
      sessionName: sessionName || undefined,
      optimisticDependsOn,
    })
  }

  const filteredNotes: Array<{ pageId: string; comment: string; dependsOn?: string[] }> = []
  for (const n of ticketNotes) {
    if (!n || typeof n !== 'object') continue
    const obj = n as Record<string, unknown>
    const pageId = String(obj.pageId ?? '')
    const comment = String(obj.comment ?? '')
    if (!validPageIds.has(pageId)) {
      warnings.push(`drop note: pageId not in task set — ${pageId}`)
      continue
    }
    if (!comment.trim()) continue
    const hash = sha1(`${pageId}::${comment}`)
    if (documentedHashes[pageId] === hash) {
      warnings.push(`drop note: duplicate content — ${pageId}`)
      continue
    }
    documentedHashes[pageId] = hash
    const dependsOn = Array.isArray(obj.dependsOn)
      ? obj.dependsOn.map(String).filter((id) => validPageIds.has(id))
      : undefined
    filteredNotes.push({ pageId, comment, dependsOn })
  }

  return {
    applied: {
      planMarkdown,
      ticketNotes: filteredNotes,
      start: filteredStart,
      blocked: blocked
        .filter((b) => b && typeof b === 'object')
        .map((b) => ({
          pageId: String((b as any).pageId ?? ''),
          reason: String((b as any).reason ?? ''),
        }))
        .filter((b) => b.pageId),
      summary,
    },
    warnings,
  }
}

export async function runPass(foundryId: string, trigger: FoundryPassTrigger): Promise<void> {
  const rt = getRuntime(foundryId)
  if (!rt) {
    console.warn(`[foundry-foreman:${foundryId}] runPass: no runtime`)
    return
  }
  const cfg = rt.config
  console.log(`[foundry-foreman:${foundryId}] runPass start (trigger=${trigger})`)

  const passIndex = rt.state.passes.length + 1
  const passDir = join(getStorePath(), 'foundry', cfg.id, `pass-${passIndex}`)
  await mkdir(passDir, { recursive: true })
  const contextPath = join(passDir, 'context.json')
  const decisionPath = join(passDir, 'decision.json')

  // Delete any stale decision file so a missing-file post-run is unambiguous.
  try {
    await unlink(decisionPath)
  } catch {
    // not present
  }

  let built: BuildContextResult | null
  try {
    built = await buildPassContext(foundryId)
  } catch (err) {
    recordPassError(rt, passIndex, trigger, err)
    return
  }
  if (!built) {
    recordPassError(rt, passIndex, trigger, new Error('foundry not configured'))
    return
  }

  await writeFile(contextPath, JSON.stringify(built.context, null, 2), 'utf-8')

  const passRecord: FoundryPassRecord = {
    index: passIndex,
    startedAt: new Date().toISOString(),
    status: 'running',
    trigger,
    startedPageIds: [],
    transcript: [],
  }
  rt.state.passes.push(passRecord)
  saveStateEmit(rt)

  const prompt = buildPassPrompt(contextPath, decisionPath, built.context, {
    passIndex,
    isFirstPass: passIndex === 1,
  })

  const window = getMainWindow()
  if (!window) {
    passRecord.status = 'error'
    passRecord.endedAt = new Date().toISOString()
    passRecord.errorMessage = 'main window unavailable'
    saveStateEmit(rt)
    return
  }

  // Spawn an INTERACTIVE claude PTY in the project repo. The prompt is piped
  // via heredoc so claude reads it on stdin before binding raw-mode TTY —
  // same trick the queued-session fire path uses. The user can also type
  // into this terminal while it runs to nudge the foreman.
  const foremanSessionId = `foundry-foreman-${cfg.id}`
  const terminalId = spawnTerminal(
    window,
    foremanSessionId,
    pickCwd(cfg),
    'claude',
    'dark',
    undefined, // claudeConfigDir — inherit user's default
    prompt,
    pickCwd(cfg), // repoPath
    false,
    foremanSessionId,
    'foreman'
  )
  rt.state.foremanTerminalId = terminalId
  console.log(`[foundry-foreman:${cfg.id}] pass #${passIndex} PTY ${terminalId} spawned`)
  saveStateEmit(rt)

  // Wait for decision.json to appear (the foreman wrote it) or for the
  // pass timeout to expire. fs.watch fires on rename/change events; we
  // double-check with existsSync because the file may take a beat to flush.
  const finished = await waitForDecision(passDir, decisionPath, PASS_TIMEOUT_MS)

  // Kill the PTY whether the foreman finished or we timed out. killTerminal
  // marks `stopped` so the auto-restart in terminal.service is suppressed.
  killTerminal(terminalId)
  // Stash the raw terminal buffer onto the pass record so the panel has
  // SOMETHING to show after the PTY is gone (ANSI-ish but readable).
  const tailBuf = getTerminalBuffer(terminalId)
  if (tailBuf) {
    for (const line of tailBuf.split('\n')) passRecord.transcript.push(line)
  }
  rt.state.foremanTerminalId = undefined
  saveStateEmit(rt)

  if (!finished) {
    passRecord.status = 'error'
    passRecord.endedAt = new Date().toISOString()
    passRecord.errorMessage = `pass timed out after ${Math.round(PASS_TIMEOUT_MS / 60000)}m without a decision.json`
    console.error(`[foundry-foreman:${cfg.id}] pass #${passIndex} timed out`)
    saveStateEmit(rt)
    return
  }

  if (!existsSync(decisionPath)) {
    passRecord.status = 'error'
    passRecord.endedAt = new Date().toISOString()
    passRecord.errorMessage = 'decision.json missing after foreman PTY exit'
    console.error(`[foundry-foreman:${cfg.id}] pass #${passIndex} decision.json missing at ${decisionPath}`)
    saveStateEmit(rt)
    return
  }
  let parsed: unknown
  try {
    const raw = await readFile(decisionPath, 'utf-8')
    parsed = JSON.parse(raw)
  } catch (err) {
    passRecord.status = 'error'
    passRecord.endedAt = new Date().toISOString()
    passRecord.errorMessage = `decision.json parse failed: ${err instanceof Error ? err.message : String(err)}`
    saveStateEmit(rt)
    return
  }
  let validation: ValidationResult
  try {
    validation = validateDecision(parsed, built.context, rt.state.documentedHashes)
  } catch (err) {
    passRecord.status = 'error'
    passRecord.endedAt = new Date().toISOString()
    passRecord.errorMessage = err instanceof Error ? err.message : String(err)
    saveStateEmit(rt)
    return
  }
  const decision = validation.applied

  if (decision.planMarkdown) {
    const planHash = sha1(decision.planMarkdown)
    if (rt.state.planMarkdownHash !== planHash) {
      rt.state.planMarkdownHash = planHash
    }
  }

  // Apply: ticket notes first (best-effort), then start pipelines.
  for (const note of decision.ticketNotes ?? []) {
    await tryAppendTicketMarkdown(cfg, note.pageId, note.comment)
  }
  const pagesById = new Map(built.pages.map((p) => [p.id, p]))
  for (const s of decision.start) {
    const page = pagesById.get(s.pageId)
    if (!page) continue
    const pipe = await startPipeline({
      foundryId: cfg.id,
      page,
      reason: s.reason,
      branchName: s.branchName,
      sessionName: s.sessionName,
      optimisticDependsOn: s.optimisticDependsOn,
    })
    if (pipe) passRecord.startedPageIds.push(s.pageId)
  }

  passRecord.status = 'completed'
  passRecord.endedAt = new Date().toISOString()
  passRecord.summary = `${decision.summary}${validation.warnings.length > 0 ? ` (warnings: ${validation.warnings.length})` : ''}`
  console.log(
    `[foundry-foreman:${cfg.id}] pass #${passIndex} completed: started=${passRecord.startedPageIds.length}, warnings=${validation.warnings.length}`
  )
  saveStateEmit(rt)
}

function recordPassError(
  rt: FoundryRuntimeRef,
  index: number,
  trigger: FoundryPassTrigger,
  err: unknown
): void {
  rt.state.passes.push({
    index,
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    status: 'error',
    trigger,
    startedPageIds: [],
    transcript: [],
    errorMessage: err instanceof Error ? err.message : String(err),
  })
  flushState(rt.config.id)
}

function saveStateEmit(rt: FoundryRuntimeRef): void {
  flushState(rt.config.id)
}

function getNotion(cfg: FoundryConfig): { apiToken: string; databaseId: string; titlePropertyName?: string } | null {
  const direct = notionAccessFor(cfg)
  if (direct) return direct
  const base = loadNotionConfig(cfg.projectId)
  const apiToken = cfg.notionOverride?.apiToken ?? base?.apiToken
  const databaseId = cfg.notionOverride?.databaseId ?? base?.databaseId
  if (!apiToken || !databaseId) return null
  return {
    apiToken,
    databaseId,
    titlePropertyName: cfg.notionOverride?.titlePropertyName ?? base?.titlePropertyName,
  }
}

interface ProjectsStoreShape {
  projects: Array<{ id: string; repoPath: string }>
}

function pickCwd(cfg: FoundryConfig): string {
  try {
    // Match project.ipc.ts — no `name`, so it reads from the default
    // config.json (where the project IPC handler persists them).
    const fresh = new Store<ProjectsStoreShape>({
      cwd: getStorePath(),
      defaults: { projects: [] },
    })
    const projects = fresh.get('projects', [])
    const proj = projects.find((p) => p.id === cfg.projectId)
    if (proj?.repoPath) return proj.repoPath
  } catch {
    // ignore
  }
  return getStorePath()
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
  return ''
}

function sha1(input: string): string {
  return createHash('sha1').update(input).digest('hex')
}

/**
 * Watch `passDir` for the foreman to write `decision.json` (or rewrite
 * it after editing). Resolves true on detection, false on timeout. Polls
 * existsSync on every event in case the watcher fires before the file is
 * fully flushed, and as a 500ms safety-net fallback in case the OS
 * dropped a watcher event.
 */
function waitForDecision(passDir: string, decisionPath: string, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false
    const finish = (ok: boolean): void => {
      if (settled) return
      settled = true
      try { watcher.close() } catch { /* already closed */ }
      clearInterval(pollTimer)
      clearTimeout(timeoutTimer)
      resolve(ok)
    }
    const watcher = fsWatch(passDir, (_event, filename) => {
      if (filename === 'decision.json' && existsSync(decisionPath)) finish(true)
    })
    watcher.on('error', () => {
      // Fall back to polling only.
    })
    const pollTimer = setInterval(() => {
      if (existsSync(decisionPath)) finish(true)
    }, 500)
    const timeoutTimer = setTimeout(() => finish(false), timeoutMs)
  })
}

const BRANCH_PREFIXES = new Set(['feat', 'fix', 'refactor', 'chore', 'docs', 'test', 'perf', 'style'])

function sanitizeSlug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

/**
 * Accept `<prefix>/<slug>` where prefix is a known conventional category.
 * Returns the sanitised branch name, or an empty string if we can't make
 * sense of the input. Caller falls back to the foundry template.
 */
function sanitizeBranchName(s: string): string {
  if (!s) return ''
  const slash = s.indexOf('/')
  if (slash <= 0) return ''
  const prefix = s.slice(0, slash).toLowerCase()
  if (!BRANCH_PREFIXES.has(prefix)) return ''
  const slug = sanitizeSlug(s.slice(slash + 1))
  if (!slug) return ''
  return `${prefix}/${slug}`
}
