/**
 * Review Loop — Lite variant.
 *
 * A lighter, unstructured cousin of review-loop.service.ts. No JSON
 * intermediates, no sticky PR comment, no structured issue list. The UI only
 * ever shows the raw session transcript.
 *
 * Per round:
 *   1. review : `claude --print` with `/review <PR#>` (or `/review` + diff)
 *   2. triage : `claude --print` with the review output dumped in, asking for
 *               a sub-agent investigation per issue. Captures session_id.
 *   3. fix    : `claude --print --resume <session_id>` with "do what you think
 *               needs doing, commit, and push" — same context as triage.
 *
 * Round-level convergence: if the fix turn produces no new commit on HEAD,
 * count that as a "clean" round. After N consecutive clean rounds, stop.
 *
 * Safety net: snapshot HEAD + dirty paths at loop start; after each fix turn,
 * if the worktree contains uncommitted changes that weren't there at start,
 * make a trailing commit so nothing is left behind.
 */
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { BrowserWindow } from 'electron'
import { IPC } from '../../shared/constants'
import {
  DEFAULT_REVIEW_LOOP_CONFIG,
  type ReviewLoopConfig,
  type ReviewLoopPhase,
  type ReviewLoopRound,
  type ReviewLoopState,
  type ReviewLoopStopReason,
} from '../../shared/types'
import { killChildTree, runHeadlessClaude, DEFAULT_PHASE_TIMEOUT_MS } from './claude-headless.service'

const execFileAsync = promisify(execFile)

const PHASE_TIMEOUT_MS = DEFAULT_PHASE_TIMEOUT_MS

interface ActiveLoop {
  sessionId: string
  state: ReviewLoopState
  cancelled: boolean
  child?: ChildProcessWithoutNullStreams
  config: ReviewLoopConfig
  prNumber?: number
  /** HEAD sha at loop start — the baseline for "did this round produce a commit". */
  startSha: string
}

const activeLoops = new Map<string, ActiveLoop>()
let mainWindow: BrowserWindow | null = null

export function setReviewLoopLiteWindow(w: BrowserWindow): void {
  mainWindow = w
}

export function hasReviewLoopLite(sessionId: string): boolean {
  return activeLoops.has(sessionId)
}

export function getReviewLoopLiteState(sessionId: string): ReviewLoopState | null {
  return activeLoops.get(sessionId)?.state ?? null
}

export function cancelReviewLoopLite(sessionId: string): void {
  const loop = activeLoops.get(sessionId)
  if (!loop || loop.state.status !== 'running') return
  loop.cancelled = true
  if (loop.child) killChildTree(loop.child)
}

export interface StartReviewLoopLiteOptions {
  sessionId: string
  worktreePath: string
  branch: string
  baseBranch: string
  config: ReviewLoopConfig
  prNumber?: number
}

export async function startReviewLoopLite(opts: StartReviewLoopLiteOptions): Promise<void> {
  if (activeLoops.get(opts.sessionId)?.state.status === 'running') {
    throw new Error('Review loop is already running for this session')
  }

  const config = { ...DEFAULT_REVIEW_LOOP_CONFIG, ...opts.config }
  const startSha = await readHeadSha(opts.worktreePath)

  const state: ReviewLoopState = {
    sessionId: opts.sessionId,
    branch: opts.branch,
    baseBranch: opts.baseBranch,
    worktreePath: opts.worktreePath,
    variant: 'lite',
    status: 'running',
    currentPhase: 'idle',
    iteration: 0,
    rounds: [],
    cumulativeCostUsd: 0,
    startedAt: new Date().toISOString(),
    skippedIssues: [],
  }

  const loop: ActiveLoop = {
    sessionId: opts.sessionId,
    state,
    cancelled: false,
    config,
    prNumber: opts.prNumber,
    startSha,
  }
  activeLoops.set(opts.sessionId, loop)
  emitState(loop)

  void runLoop(loop).catch((err: unknown) => {
    finalize(loop, 'error', err instanceof Error ? err.message : String(err))
  })
}

async function runLoop(loop: ActiveLoop): Promise<void> {
  let consecutiveClean = 0
  let priorHead = loop.startSha

  const costCapTripped = (): boolean =>
    loop.state.cumulativeCostUsd >= loop.config.costCapUsd

  while (true) {
    if (loop.cancelled) return finalize(loop, 'cancelled')
    if (loop.state.iteration >= loop.config.maxIterations) return finalize(loop, 'maxIterations')
    if (costCapTripped()) return finalize(loop, 'costCap')

    const round = startRound(loop)

    // ── Review ──
    const reviewOk = await runReviewPhase(loop, round)
    if (!reviewOk) return
    if (loop.cancelled) return finalize(loop, 'cancelled')
    if (costCapTripped()) return finalize(loop, 'costCap')

    // ── Triage (captures session id for fix to resume) ──
    const triageResult = await runTriagePhase(loop, round)
    if (!triageResult.ok) return
    if (loop.cancelled) return finalize(loop, 'cancelled')
    if (costCapTripped()) return finalize(loop, 'costCap')

    // ── Fix (resumes triage session) ──
    if (triageResult.sessionId) {
      const fixOk = await runFixPhase(loop, round, triageResult.sessionId)
      if (!fixOk) return
      if (loop.cancelled) return finalize(loop, 'cancelled')
      if (costCapTripped()) return finalize(loop, 'costCap')
    } else {
      pushLog(round, 'Skipping fix phase: no session id captured from triage.')
    }

    // ── Safety net: commit any uncommitted changes left over ──
    await trailingCommitIfDirty(loop, round)

    // ── Convergence check ──
    const newHead = await readHeadSha(loop.state.worktreePath).catch(() => priorHead)
    if (newHead === priorHead) {
      consecutiveClean += 1
      pushLog(round, `No new commit this round (${consecutiveClean} clean ${consecutiveClean === 1 ? 'round' : 'rounds'} so far).`)
    } else {
      consecutiveClean = 0
      priorHead = newHead
    }

    round.endedAt = new Date().toISOString()
    round.phase = 'idle'
    emitState(loop)

    if (consecutiveClean >= loop.config.consecutiveCleanRounds) {
      return finalize(loop, 'converged')
    }
  }
}

function startRound(loop: ActiveLoop): ReviewLoopRound {
  loop.state.iteration += 1
  const round: ReviewLoopRound = {
    index: loop.state.iteration,
    startedAt: new Date().toISOString(),
    phase: 'idle',
    rawIssues: [],
    triaged: [],
    costUsd: 0,
    log: [],
    transcript: [],
  }
  loop.state.rounds.push(round)
  emitState(loop)
  return round
}

/* ── Phases ─────────────────────────────────────────────────────────────── */

async function runReviewPhase(loop: ActiveLoop, round: ReviewLoopRound): Promise<boolean> {
  setPhase(loop, round, 'review')

  let prompt: string
  if (loop.prNumber) {
    pushLog(round, `Running /review ${loop.prNumber}…`)
    prompt = `/review ${loop.prNumber}`
  } else {
    pushLog(round, `Running /review on diff ${loop.state.baseBranch}...${loop.state.branch}…`)
    const diff = await readDiff(loop.state.worktreePath, loop.state.baseBranch, loop.state.branch)
    prompt = `/review\n\nHere is the diff between this branch and its base (${loop.state.baseBranch}...${loop.state.branch}):\n\n\`\`\`diff\n${diff}\n\`\`\``
  }

  const result = await runClaude(loop, round, prompt, undefined)
  round.costUsd += result.costUsd
  loop.state.cumulativeCostUsd += result.costUsd

  if (loop.cancelled) return false
  if (!result.ok) {
    round.errorMessage = result.error ?? 'review phase failed'
    pushLog(round, `Review phase failed: ${round.errorMessage}`)
    finalize(loop, 'error', round.errorMessage)
    return false
  }
  return true
}

interface TriageResult { ok: boolean; sessionId?: string }

async function runTriagePhase(loop: ActiveLoop, round: ReviewLoopRound): Promise<TriageResult> {
  setPhase(loop, round, 'triage')
  pushLog(round, 'Triaging review output…')

  const reviewTranscript = round.transcript.join('\n')

  const prompt = `Below is the output from a code review I just ran on branch "${loop.state.branch}" (base: "${loop.state.baseBranch}"):

<review>
${reviewTranscript}
</review>

For each of the issues listed above, use a sub-agent (Task tool) to investigate it. For each one:

- Check that the issue was introduced on this branch (not pre-existing on ${loop.state.baseBranch}).
- Check that the issue is real — not a false positive, misunderstanding, or stale finding.
- Decide what we should do, if anything. Options include fixing it now, deferring it, skipping it deliberately, or dismissing it as not a real problem.
- Explain what you'd do and why.

Present your findings to me as a markdown table with columns: Issue · Real? · Introduced here? · Decision · Reason.

Do not make any changes yet. Just show me your triaged issues.`

  const result = await runClaude(loop, round, prompt, undefined)
  round.costUsd += result.costUsd
  loop.state.cumulativeCostUsd += result.costUsd

  if (loop.cancelled) return { ok: false }
  if (!result.ok) {
    round.errorMessage = result.error ?? 'triage phase failed'
    pushLog(round, `Triage phase failed: ${round.errorMessage}`)
    finalize(loop, 'error', round.errorMessage)
    return { ok: false }
  }
  return { ok: true, sessionId: result.sessionId }
}

async function runFixPhase(loop: ActiveLoop, round: ReviewLoopRound, resumeId: string): Promise<boolean> {
  setPhase(loop, round, 'fix')
  pushLog(round, `Applying fixes (resuming session ${resumeId.slice(0, 8)}…)…`)

  const prompt = `Now do what you think needs doing based on the triage above. Apply the fixes you decided on, commit the result with a clear message, and push to origin/${loop.state.branch}.`

  const result = await runClaude(loop, round, prompt, resumeId)
  round.costUsd += result.costUsd
  loop.state.cumulativeCostUsd += result.costUsd

  if (loop.cancelled) return false
  if (!result.ok) {
    round.errorMessage = result.error ?? 'fix phase failed'
    pushLog(round, `Fix phase failed: ${round.errorMessage}`)
    finalize(loop, 'error', round.errorMessage)
    return false
  }
  return true
}

/* ── Safety net + git helpers ───────────────────────────────────────────── */

async function trailingCommitIfDirty(loop: ActiveLoop, round: ReviewLoopRound): Promise<void> {
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: loop.state.worktreePath })
    if (!stdout.trim()) return
    pushLog(round, 'Worktree has uncommitted changes after fix phase — making a trailing commit.')
    await execFileAsync('git', ['add', '-A'], { cwd: loop.state.worktreePath })
    await execFileAsync(
      'git',
      ['commit', '-m', `review-loop: trailing changes from round ${round.index}`],
      { cwd: loop.state.worktreePath }
    )
    try {
      await execFileAsync('git', ['push', 'origin', loop.state.branch], { cwd: loop.state.worktreePath })
    } catch (err) {
      pushLog(round, `Trailing push failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  } catch (err) {
    pushLog(round, `Trailing commit check failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function readHeadSha(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd })
    return stdout.trim()
  } catch {
    return ''
  }
}

async function readDiff(cwd: string, base: string, branch: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['diff', `${base}...${branch}`],
      { cwd, maxBuffer: 25 * 1024 * 1024 }
    )
    return stdout
  } catch (err) {
    return `(failed to read diff: ${err instanceof Error ? err.message : String(err)})`
  }
}

/* ── Claude subprocess runner ───────────────────────────────────────────── */

interface ClaudeResult {
  ok: boolean
  costUsd: number
  sessionId?: string
  error?: string
}

async function runClaude(
  loop: ActiveLoop,
  round: ReviewLoopRound,
  prompt: string,
  resumeId: string | undefined
): Promise<ClaudeResult> {
  let lastEmit = 0
  let pendingEmit: NodeJS.Timeout | null = null
  const scheduleEmit = (): void => {
    const now = Date.now()
    const elapsed = now - lastEmit
    if (elapsed >= 200) {
      lastEmit = now
      emitState(loop)
      return
    }
    if (pendingEmit) return
    pendingEmit = setTimeout(() => {
      pendingEmit = null
      lastEmit = Date.now()
      emitState(loop)
    }, 200 - elapsed)
  }

  const result = await runHeadlessClaude({
    cwd: loop.state.worktreePath,
    prompt,
    resumeId,
    timeoutMs: PHASE_TIMEOUT_MS,
    onTranscript: (line) => {
      round.transcript.push(line)
      scheduleEmit()
    },
    onChild: (child) => {
      loop.child = child
    },
  })

  loop.child = undefined
  if (pendingEmit) clearTimeout(pendingEmit)
  emitState(loop)

  if (!result.ok) {
    return { ok: false, costUsd: result.costUsd, sessionId: result.sessionId, error: result.error }
  }
  return { ok: true, costUsd: result.costUsd, sessionId: result.sessionId }
}

/* ── State helpers ──────────────────────────────────────────────────────── */

function setPhase(loop: ActiveLoop, round: ReviewLoopRound, phase: ReviewLoopPhase): void {
  round.phase = phase
  loop.state.currentPhase = phase
  emitState(loop)
}

function pushLog(round: ReviewLoopRound, line: string): void {
  round.log.push(`[${new Date().toISOString()}] ${line}`)
}

function emitState(loop: ActiveLoop): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send(IPC.REVIEW_LOOP_STATE_UPDATE, structuredClone(loop.state))
}

function finalize(loop: ActiveLoop, reason: ReviewLoopStopReason, errorMessage?: string): void {
  if (loop.state.status !== 'running') return

  loop.state.status =
    reason === 'cancelled' ? 'cancelled' :
    reason === 'error' ? 'error' :
    'completed'
  loop.state.stopReason = reason
  loop.state.currentPhase = 'idle'
  loop.state.endedAt = new Date().toISOString()
  if (errorMessage) loop.state.errorMessage = errorMessage
  emitState(loop)

  activeLoops.delete(loop.sessionId)
}
