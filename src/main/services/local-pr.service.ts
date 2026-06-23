import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import Store from 'electron-store'
import type { BrowserWindow } from 'electron'
import { IPC } from '../../shared/constants'
import type {
  CreateLocalPRFromSessionInput,
  LocalPR,
  LocalPRUpdate,
} from '../../shared/types'
import { getStorePath } from '../store-path'
import { eventBus, emitToRenderer } from './event-bus'
import * as gitService from './git.service'

const execFileAsync = promisify(execFile)

interface LocalPRStoreShape {
  byProject: Record<string, LocalPR[]>
  /** Monotonic counter for `LocalPR.localNumber` across the whole store. */
  seq: number
}

// Lazily created so importing this module never touches `electron.app` at load
// time (keeps it importable from unit tests that don't mock electron).
let _store: Store<LocalPRStoreShape> | null = null
function store(): Store<LocalPRStoreShape> {
  if (!_store) {
    _store = new Store<LocalPRStoreShape>({
      name: 'local-prs',
      cwd: getStorePath(),
      defaults: { byProject: {}, seq: 0 },
    })
  }
  return _store
}

let mainWindow: BrowserWindow | null = null

/** Event emitted on the process bus when a local PR is created/changed. */
export const LOCAL_PR_CHANGED = 'local-pr:changed'

/**
 * Per-context capture intent. A context (session id, or a foundry worker
 * context) is registered here when its terminals should run the gh shim. The
 * presence of a key means "capture on"; the value carries optional Foundry
 * metadata used to populate the chained-stack fields on the captured record.
 */
export interface LocalPRCaptureMeta {
  foundryId?: string
  pipelineId?: string
  order?: number
  parentLocalPrId?: string
}

const captureByContext = new Map<string, LocalPRCaptureMeta>()

export function setCaptureContext(contextId: string, meta: LocalPRCaptureMeta | null): void {
  if (meta) captureByContext.set(contextId, meta)
  else captureByContext.delete(contextId)
}

export function shouldCaptureContext(contextId: string): boolean {
  return captureByContext.has(contextId)
}

export function getCaptureContext(contextId: string): LocalPRCaptureMeta | undefined {
  return captureByContext.get(contextId)
}

export function startLocalPRService(window: BrowserWindow): void {
  mainWindow = window
}

export function stopLocalPRService(): void {
  mainWindow = null
}

// ── Persistence helpers ─────────────────────────────────────────────────────

function readAll(): Record<string, LocalPR[]> {
  return store().get('byProject', {})
}

function writeProject(projectId: string, list: LocalPR[]): void {
  const all = readAll()
  all[projectId] = list
  store().set('byProject', all)
}

function nextLocalNumber(): number {
  const n = store().get('seq', 0) + 1
  store().set('seq', n)
  return n
}

function nowIso(): string {
  return new Date().toISOString()
}

/** Push the full list for a project to the renderer + bus subscribers. */
function emitForProject(projectId: string): void {
  const list = listLocalPRs(projectId)
  emitToRenderer(mainWindow, IPC.LOCAL_PR_STATE_UPDATE, projectId, list)
}

// ── Reads ───────────────────────────────────────────────────────────────────

export function listLocalPRs(projectId: string): LocalPR[] {
  return readAll()[projectId] ?? []
}

export function getLocalPR(id: string): LocalPR | null {
  for (const list of Object.values(readAll())) {
    const found = list.find((p) => p.id === id)
    if (found) return found
  }
  return null
}

export function getLocalPRForPipeline(pipelineId: string): LocalPR | null {
  for (const list of Object.values(readAll())) {
    const found = list.find((p) => p.pipelineId === pipelineId)
    if (found) return found
  }
  return null
}

// ── Mutations ─────────────────────────────────────────────────────────────

/**
 * Internal: persist a new or updated record. Bumps `updatedAt`, writes to the
 * store, emits to the renderer, and fires the bus event. Returns the record.
 */
export function upsertLocalPR(pr: LocalPR): LocalPR {
  const next: LocalPR = { ...pr, updatedAt: nowIso() }
  const list = listLocalPRs(next.projectId)
  const idx = list.findIndex((p) => p.id === next.id)
  if (idx === -1) list.push(next)
  else list[idx] = next
  writeProject(next.projectId, list)
  emitForProject(next.projectId)
  eventBus.emit(LOCAL_PR_CHANGED, next)
  return next
}

/** Apply a partial patch to an existing record and persist. */
export function patchLocalPR(id: string, patch: Partial<LocalPR>): LocalPR | null {
  const existing = getLocalPR(id)
  if (!existing) return null
  return upsertLocalPR({ ...existing, ...patch })
}

/** Append a line to the record's log (bounded) and persist. */
export function appendLog(id: string, message: string): void {
  const existing = getLocalPR(id)
  if (!existing) return
  const log = [...existing.log, `${nowIso()} ${message}`].slice(-200)
  upsertLocalPR({ ...existing, log })
}

/**
 * Snapshot a session's branch into a local PR. Resolves base, derives a default
 * title/body from the last commit, captures HEAD sha, and pushes the branch
 * defensively so a later promote always has something to open a PR from.
 */
export async function createFromSession(
  input: CreateLocalPRFromSessionInput
): Promise<LocalPR> {
  const { projectId, sessionId, worktreePath, branch } = input
  const baseBranch =
    input.baseBranch || (await safeDefaultBranch(worktreePath))

  const { title, body } = await deriveTitleBody(worktreePath, branch, input)
  const headSha = await safeHeadSha(worktreePath)

  // Defensive push so promote has an upstream branch. Best-effort: a local PR
  // is still valid (and promotable later) even if the push fails right now.
  try {
    await gitService.pushBranch(worktreePath)
  } catch {
    /* surfaced on promote if it still can't push */
  }

  const id = `lpr-${randomUUID().slice(0, 8)}`
  const ts = nowIso()
  const pr: LocalPR = {
    id,
    localNumber: nextLocalNumber(),
    projectId,
    sessionId,
    worktreePath,
    title,
    body,
    branch,
    headSha,
    baseBranch,
    status: 'local',
    createdAt: ts,
    updatedAt: ts,
    log: [`${ts} created from session ${sessionId}`],
  }
  return upsertLocalPR(pr)
}

/** Synthetic PR URL handed back to the agent so `gh pr create` looks normal. */
function fakeUrl(localNumber: number): string {
  return `https://github.com/local/local/pull/${localNumber}`
}

/**
 * Turn a captured `gh pr create` (from the gh shim) into a local PR. Resolves
 * branch/base/sha, links Foundry metadata if the context registered any, and
 * returns the fake PR ref the shim echoes to the agent. Idempotent on re-run:
 * an existing `local` record for the same branch is updated in place.
 */
export async function captureLocalPR(args: {
  contextId: string
  projectId: string
  worktreePath: string
  fields: {
    title: string
    body: string
    base?: string
    head?: string
    sha?: string
    draft?: boolean
  }
}): Promise<{ number: number; url: string }> {
  const { contextId, projectId, worktreePath, fields } = args
  const meta = getCaptureContext(contextId)
  const branch = fields.head || (await currentBranch(worktreePath)) || 'HEAD'
  const baseBranch = fields.base || (await safeDefaultBranch(worktreePath))
  const headSha = fields.sha || (await safeHeadSha(worktreePath))
  const title = fields.title || branchToTitle(branch)

  // Idempotent: update an existing un-promoted record for this branch.
  const existing = listLocalPRs(projectId).find(
    (p) => p.branch === branch && p.status === 'local'
  )
  if (existing) {
    const updated = upsertLocalPR({
      ...existing,
      title,
      body: fields.body || existing.body,
      baseBranch: meta?.parentLocalPrId ? existing.baseBranch : baseBranch,
      headSha,
      worktreePath,
      sessionId: existing.sessionId ?? contextId,
      foundryId: meta?.foundryId ?? existing.foundryId,
      pipelineId: meta?.pipelineId ?? existing.pipelineId,
      order: meta?.order ?? existing.order,
      parentLocalPrId: meta?.parentLocalPrId ?? existing.parentLocalPrId,
    })
    return { number: updated.localNumber, url: fakeUrl(updated.localNumber) }
  }

  const localNumber = nextLocalNumber()
  const ts = nowIso()
  const pr: LocalPR = {
    id: `lpr-${randomUUID().slice(0, 8)}`,
    localNumber,
    projectId,
    sessionId: contextId,
    worktreePath,
    foundryId: meta?.foundryId,
    pipelineId: meta?.pipelineId,
    order: meta?.order,
    parentLocalPrId: meta?.parentLocalPrId,
    title,
    body: fields.body,
    branch,
    headSha,
    baseBranch,
    status: 'local',
    createdAt: ts,
    updatedAt: ts,
    log: [`${ts} captured from gh pr create (context ${contextId})`],
  }
  upsertLocalPR(pr)
  return { number: localNumber, url: fakeUrl(localNumber) }
}

export function updateLocalPR(id: string, update: LocalPRUpdate): LocalPR | null {
  const patch: Partial<LocalPR> = {}
  if (update.title !== undefined) patch.title = update.title
  if (update.body !== undefined) patch.body = update.body
  if (update.baseBranch !== undefined) patch.baseBranch = update.baseBranch
  if (Object.keys(patch).length === 0) return getLocalPR(id)
  return patchLocalPR(id, patch)
}

export function discardLocalPR(id: string): void {
  const existing = getLocalPR(id)
  if (!existing) return
  const list = listLocalPRs(existing.projectId).filter((p) => p.id !== id)
  writeProject(existing.projectId, list)
  emitForProject(existing.projectId)
}

// ── git helpers (best-effort) ────────────────────────────────────────────────

async function safeDefaultBranch(worktreePath: string): Promise<string> {
  try {
    return await gitService.getDefaultBranch(worktreePath)
  } catch {
    return 'main'
  }
}

async function currentBranch(worktreePath: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: worktreePath,
    })
    return stdout.trim() || undefined
  } catch {
    return undefined
  }
}

async function safeHeadSha(worktreePath: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
      cwd: worktreePath,
    })
    return stdout.trim() || undefined
  } catch {
    return undefined
  }
}

async function deriveTitleBody(
  worktreePath: string,
  branch: string,
  input: CreateLocalPRFromSessionInput
): Promise<{ title: string; body: string }> {
  if (input.title !== undefined) {
    return { title: input.title, body: input.body ?? '' }
  }
  // Default the title to the last commit subject, the body to its message body.
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['log', '-1', '--pretty=format:%s%n%n%b'],
      { cwd: worktreePath }
    )
    const text = stdout.trim()
    const nl = text.indexOf('\n')
    const title = (nl === -1 ? text : text.slice(0, nl)).trim()
    const body = nl === -1 ? '' : text.slice(nl).trim()
    return {
      title: title || branchToTitle(branch),
      body: input.body ?? body,
    }
  } catch {
    return { title: branchToTitle(branch), body: input.body ?? '' }
  }
}

function branchToTitle(branch: string): string {
  // feat/some-thing → "Some thing"
  const slug = branch.split('/').pop() ?? branch
  const words = slug.replace(/[-_]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}
