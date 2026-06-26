import { randomUUID } from 'node:crypto'
import Store from 'electron-store'
import type { BrowserWindow } from 'electron'
import { IPC } from '../../shared/constants'
import type { PRStack, PRStackEntry, PRStackEntryKind, Project, FoundryConfig, LocalPR } from '../../shared/types'
import { getStorePath } from '../store-path'
import { eventBus, emitToRenderer } from './event-bus'
import { getLocalPR, patchLocalPR, LOCAL_PR_CHANGED } from './local-pr.service'
import { promoteLocalPR } from './local-pr-promote.service'
import * as github from './github.service'

interface PRStackStoreShape {
  byProject: Record<string, PRStack[]>
}

// Lazily created so importing this module never touches `electron.app` at load
// time (keeps it importable from unit tests that don't mock electron).
let _store: Store<PRStackStoreShape> | null = null
function store(): Store<PRStackStoreShape> {
  if (!_store) {
    _store = new Store<PRStackStoreShape>({
      name: 'pr-stacks',
      cwd: getStorePath(),
      defaults: { byProject: {} },
    })
  }
  return _store
}

let mainWindow: BrowserWindow | null = null

/** Event emitted on the process bus when a stack is created/changed. */
export const PR_STACK_CHANGED = 'pr-stack:changed'

let unsubLocalPR: (() => void) | null = null

export function startPRStackService(window: BrowserWindow): void {
  mainWindow = window
  // Funnel foundry-produced local PRs into a managed stack (one per foundry).
  // Only acts on the first sighting of a local PR; status-only changes for an
  // already-tracked entry are ignored so relinkChain's own patches don't loop.
  if (!unsubLocalPR) {
    const onLocalPRChanged = (lpr: LocalPR): void => {
      if (!lpr?.foundryId) return
      const existing = getStackForFoundry(lpr.foundryId)
      if (existing && existing.entries.some((e) => e.localPrId === lpr.id)) return
      const meta = getFoundryMeta(lpr.foundryId)
      ensureStackForFoundry(lpr.foundryId, lpr.projectId, meta.name, meta.baseBranch, lpr.id)
    }
    eventBus.on(LOCAL_PR_CHANGED, onLocalPRChanged)
    unsubLocalPR = () => eventBus.off(LOCAL_PR_CHANGED, onLocalPRChanged)
  }
}

export function stopPRStackService(): void {
  mainWindow = null
  unsubLocalPR?.()
  unsubLocalPR = null
}

/** Read a foundry's display name + integration branch from its config store. */
function getFoundryMeta(foundryId: string): { name: string; baseBranch: string } {
  const cfgStore = new Store<{ foundries: FoundryConfig[] }>({
    cwd: getStorePath(),
    name: 'foundry-config',
    defaults: { foundries: [] },
  })
  const cfg = cfgStore.get('foundries', []).find((f) => f.id === foundryId)
  const baseBranch = cfg?.foundryBranch || `foundry/integration-${foundryId}`
  return { name: cfg?.name ? `${cfg.name}` : `Foundry ${foundryId.slice(0, 6)}`, baseBranch }
}

// ── Persistence helpers ─────────────────────────────────────────────────────

function readAll(): Record<string, PRStack[]> {
  return store().get('byProject', {})
}

function writeProject(projectId: string, list: PRStack[]): void {
  const all = readAll()
  all[projectId] = list
  store().set('byProject', all)
}

function nowIso(): string {
  return new Date().toISOString()
}

/** Push the full list for a project to the renderer + bus subscribers. */
function emitForProject(projectId: string): void {
  emitToRenderer(mainWindow, IPC.PR_STACK_STATE_UPDATE, projectId, listStacks(projectId))
}

// ── Reads ───────────────────────────────────────────────────────────────────

export function listStacks(projectId: string): PRStack[] {
  return readAll()[projectId] ?? []
}

export function getStack(id: string): PRStack | null {
  for (const list of Object.values(readAll())) {
    const found = list.find((s) => s.id === id)
    if (found) return found
  }
  return null
}

/** Find a foundry-created stack for a run, if one exists. */
export function getStackForFoundry(foundryId: string): PRStack | null {
  for (const list of Object.values(readAll())) {
    const found = list.find((s) => s.foundryId === foundryId)
    if (found) return found
  }
  return null
}

// ── Mutations ─────────────────────────────────────────────────────────────

/**
 * Internal: persist a new or updated stack. Bumps `updatedAt`, writes to the
 * store, emits to the renderer, and fires the bus event. Returns the stack.
 */
function upsert(stack: PRStack): PRStack {
  const next: PRStack = { ...stack, updatedAt: nowIso() }
  const list = listStacks(next.projectId)
  const idx = list.findIndex((s) => s.id === next.id)
  if (idx === -1) list.push(next)
  else list[idx] = next
  writeProject(next.projectId, list)
  emitForProject(next.projectId)
  eventBus.emit(PR_STACK_CHANGED, next)
  return next
}

export interface CreateStackInput {
  projectId: string
  name: string
  baseBranch: string
  foundryId?: string
}

export function createStack(input: CreateStackInput): PRStack {
  const ts = nowIso()
  const stack: PRStack = {
    id: `stk-${randomUUID().slice(0, 8)}`,
    projectId: input.projectId,
    name: input.name,
    baseBranch: input.baseBranch,
    foundryId: input.foundryId,
    entries: [],
    publish: { status: 'idle', log: [] },
    propagation: { status: 'idle', log: [] },
    createdAt: ts,
    updatedAt: ts,
  }
  return upsert(stack)
}

export function renameStack(id: string, name: string): PRStack | null {
  const stack = getStack(id)
  if (!stack) return null
  return upsert({ ...stack, name })
}

export function deleteStack(id: string): void {
  const stack = getStack(id)
  if (!stack) return
  const list = listStacks(stack.projectId).filter((s) => s.id !== id)
  writeProject(stack.projectId, list)
  emitForProject(stack.projectId)
}

export interface AddEntryInput {
  kind: PRStackEntryKind
  localPrId?: string
  prNumber?: number
  /** Denormalized branch/base for real entries (from the PR being added). */
  branch?: string
  baseBranch?: string
}

/** Add an entry to the top of the stack (highest order) and relink the chain. */
export function addEntry(stackId: string, input: AddEntryInput): PRStack | null {
  const stack = getStack(stackId)
  if (!stack) return null
  // Idempotent: don't add the same PR twice.
  const dup = stack.entries.find((e) =>
    input.kind === 'local' ? e.localPrId === input.localPrId : e.prNumber === input.prNumber
  )
  if (dup) return stack
  const entry: PRStackEntry = {
    id: `ent-${randomUUID().slice(0, 8)}`,
    kind: input.kind,
    localPrId: input.localPrId,
    prNumber: input.prNumber,
    branch: input.branch,
    baseBranch: input.baseBranch,
    order: stack.entries.length,
  }
  const entries = [...stack.entries, entry]
  return persistWithRelink({ ...stack, entries })
}

export function removeEntry(stackId: string, entryId: string): PRStack | null {
  const stack = getStack(stackId)
  if (!stack) return null
  const entries = stack.entries.filter((e) => e.id !== entryId)
  if (entries.length === stack.entries.length) return stack
  return persistWithRelink({ ...stack, entries })
}

/** Reorder entries to match `orderedEntryIds` (bottom-first) and relink. */
export function reorderEntries(stackId: string, orderedEntryIds: string[]): PRStack | null {
  const stack = getStack(stackId)
  if (!stack) return null
  const byId = new Map(stack.entries.map((e) => [e.id, e]))
  const reordered: PRStackEntry[] = []
  for (const id of orderedEntryIds) {
    const e = byId.get(id)
    if (e) {
      reordered.push(e)
      byId.delete(id)
    }
  }
  // Any entries not named in the list keep their relative order at the top.
  for (const e of stack.entries) if (byId.has(e.id)) reordered.push(e)
  return persistWithRelink({ ...stack, entries: reordered })
}

/** Append `source`'s entries onto `target`, relink, and delete `source`. */
export function mergeStacks(targetId: string, sourceId: string): PRStack | null {
  const target = getStack(targetId)
  const source = getStack(sourceId)
  if (!target || !source) return null
  if (target.id === source.id) return target
  const existing = new Set(
    target.entries.map((e) => (e.kind === 'local' ? `l:${e.localPrId}` : `r:${e.prNumber}`))
  )
  const incoming = source.entries.filter(
    (e) => !existing.has(e.kind === 'local' ? `l:${e.localPrId}` : `r:${e.prNumber}`)
  )
  const merged = persistWithRelink({ ...target, entries: [...target.entries, ...incoming] })
  deleteStack(source.id)
  return merged
}

/**
 * Foundry integration: ensure a stack exists for a run (create once), then make
 * sure `localPrId` is present as an entry. Called from the LOCAL_PR_CHANGED
 * listener (Phase 3) so a run's local PRs flow into a managed stack.
 */
export function ensureStackForFoundry(
  foundryId: string,
  projectId: string,
  name: string,
  baseBranch: string,
  localPrId: string
): PRStack {
  let stack = getStackForFoundry(foundryId)
  if (!stack) stack = createStack({ projectId, name, baseBranch, foundryId })
  const updated = addEntry(stack.id, { kind: 'local', localPrId })
  return updated ?? stack
}

// ── Chain relinking ─────────────────────────────────────────────────────────

/**
 * Recompute `order`, denormalize branch/base from referenced records, and push
 * the parent chain down to the local PRs: each local entry's `parentLocalPrId`
 * points at the entry below it (when that entry is also local), or its
 * `baseBranch` is set to the predecessor's branch (when the predecessor is a
 * real PR) / the stack base (when it's the bottom entry). This mirrors the
 * chain-linking in foundry's publishLocalPRStack so promote resolves the right
 * base for each PR.
 */
function relinkChain(stack: PRStack): void {
  stack.entries.forEach((e, i) => {
    e.order = i
    if (e.kind === 'local' && e.localPrId) {
      const lpr = getLocalPR(e.localPrId)
      if (lpr) e.branch = lpr.branch
    }
  })
  stack.entries.forEach((e, i) => {
    if (e.kind !== 'local' || !e.localPrId) return
    const prev = i > 0 ? stack.entries[i - 1] : undefined
    if (!prev) {
      patchLocalPR(e.localPrId, { parentLocalPrId: undefined, baseBranch: stack.baseBranch })
      e.baseBranch = stack.baseBranch
    } else if (prev.kind === 'local' && prev.localPrId) {
      patchLocalPR(e.localPrId, { parentLocalPrId: prev.localPrId })
      e.baseBranch = prev.branch
    } else {
      const base = prev.branch ?? stack.baseBranch
      patchLocalPR(e.localPrId, { parentLocalPrId: undefined, baseBranch: base })
      e.baseBranch = base
    }
  })
}

function persistWithRelink(stack: PRStack): PRStack {
  relinkChain(stack)
  return upsert(stack)
}

// ── Shared helpers (repo path, ordering, logging) ───────────────────────────

/** Resolve a project's repo path (same lookup as local-pr-promote.service). */
export function getProjectRepoPath(projectId: string): string | null {
  const projectsStore = new Store<{ projects: Project[] }>({
    cwd: getStorePath(),
    defaults: { projects: [] },
  })
  return projectsStore.get('projects', []).find((p) => p.id === projectId)?.repoPath ?? null
}

/** Entries sorted bottom-first (order 0 = base). */
function orderedEntries(stack: PRStack): PRStackEntry[] {
  return [...stack.entries].sort((a, b) => a.order - b.order)
}

/** The branch a real entry should target = its predecessor's branch (or base). */
function baseForEntry(stack: PRStack, ordered: PRStackEntry[], index: number): string {
  const prev = index > 0 ? ordered[index - 1] : undefined
  return prev?.branch ?? stack.baseBranch
}

function publishLog(stackId: string, message: string): void {
  const stack = getStack(stackId)
  if (!stack) return
  const pub = stack.publish ?? { status: 'idle' as const, log: [] }
  const log = [...pub.log, `${nowIso()} ${message}`].slice(-200)
  upsert({ ...stack, publish: { ...pub, log } })
}

function setPublish(stackId: string, patch: Partial<NonNullable<PRStack['publish']>>): void {
  const stack = getStack(stackId)
  if (!stack) return
  const pub = stack.publish ?? { status: 'idle' as const, log: [] }
  upsert({ ...stack, publish: { ...pub, ...patch } })
}

// ── Publish — promote the whole stack to real chained GitHub PRs ─────────────

const publishInFlight = new Set<string>()

/**
 * Walk the stack bottom-to-top and turn it into a real chain of GitHub PRs:
 * local entries are promoted (push branch + open draft PR, chained base already
 * linked by relinkChain), and real entries are retargeted onto their
 * predecessor's branch. Idempotent and resumable — already-promoted local
 * entries are skipped, so re-invoking after an error/restart continues from
 * where it left off. CI gating is foundry-specific and stays in
 * foundry.publishLocalPRStack (see plan follow-up: unify the two cursors).
 */
export async function publishStack(stackId: string): Promise<void> {
  const stack = getStack(stackId)
  if (!stack) return
  if (publishInFlight.has(stackId)) return
  publishInFlight.add(stackId)

  const repoPath = getProjectRepoPath(stack.projectId)
  setPublish(stackId, {
    status: 'running',
    startedAt: stack.publish?.startedAt ?? nowIso(),
    currentEntryId: undefined,
  })
  publishLog(stackId, 'Publishing stack…')

  try {
    const ordered = orderedEntries(stack)
    for (let i = 0; i < ordered.length; i++) {
      const entry = ordered[i]
      setPublish(stackId, { currentEntryId: entry.id })

      if (entry.kind === 'local') {
        const lpr = entry.localPrId ? getLocalPR(entry.localPrId) : null
        if (!lpr) {
          publishLog(stackId, `skip: local PR ${entry.localPrId} not found`)
          continue
        }
        if (lpr.realPrNumber || lpr.status === 'open' || lpr.status === 'merged') {
          publishLog(stackId, `LOCAL-${lpr.localNumber} already published (#${lpr.realPrNumber})`)
          continue
        }
        publishLog(stackId, `Promoting LOCAL-${lpr.localNumber} (${lpr.title})…`)
        const promoted = await promoteLocalPR(lpr.id, { markReady: true })
        if (!promoted || promoted.status === 'error') {
          setPublish(stackId, { status: 'error' })
          publishLog(stackId, `LOCAL-${lpr.localNumber} failed to promote — stopping.`)
          return
        }
        publishLog(stackId, `→ PR #${promoted.realPrNumber}`)
      } else if (entry.kind === 'real' && entry.prNumber && repoPath) {
        const base = baseForEntry(stack, ordered, i)
        await github.setPRBase(repoPath, entry.prNumber, base)
        publishLog(stackId, `Retargeted #${entry.prNumber} → ${base}`)
      }
    }
    setPublish(stackId, { status: 'done', currentEntryId: undefined })
    publishLog(stackId, 'Stack published.')
  } catch (err) {
    setPublish(stackId, { status: 'error' })
    publishLog(stackId, `Publish failed: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    publishInFlight.delete(stackId)
  }
}

/** Test-only: reset the lazy store handle. */
export function __resetForTests(): void {
  _store = null
  mainWindow = null
}
