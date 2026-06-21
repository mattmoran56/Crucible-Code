/**
 * Review Loop — Lite variant.
 *
 * A lighter, unstructured cousin of review-loop.service.ts. No JSON
 * intermediates and no sticky PR comment — just three live, interactive
 * `claude` terminals per round that the user can watch and type into.
 *
 * Per round:
 *   1. review : `/review <PR#>` (or `/review` + diff) in a foreground terminal.
 *   2. triage : the review terminal's output is handed to a fresh terminal that
 *               investigates each issue with sub-agents and presents a table.
 *   3. fix    : the triage terminal's output is handed to a fresh terminal that
 *               does what it decided, commits, and pushes.
 *
 * Each phase advances when its `Stop` hook fires (see review-phase.service);
 * the three terminals are independent sessions, with context passed between
 * them as captured (ANSI-stripped) terminal output rather than `--resume`.
 *
 * Round-level convergence: if the fix turn produces no new commit on HEAD,
 * count that as a "clean" round. After N consecutive clean rounds, stop.
 *
 * Safety net: snapshot HEAD at loop start; after each fix turn, if the worktree
 * contains uncommitted changes, make a trailing commit so nothing is left
 * behind.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { BrowserWindow } from 'electron'
import { IPC } from '../../shared/constants'
import {
  DEFAULT_REVIEW_LOOP_CONFIG,
  type ReviewLoopConfig,
  type ReviewLoopPhase,
  type ReviewLoopPhaseSlot,
  type ReviewLoopRound,
  type ReviewLoopState,
  type ReviewLoopStopReason,
} from '../../shared/types'
import {
  runForegroundPhase,
  DEFAULT_PHASE_TIMEOUT_MS,
  type ForegroundPhaseResult,
} from './review-phase.service'

const execFileAsync = promisify(execFile)

const PHASE_TIMEOUT_MS = DEFAULT_PHASE_TIMEOUT_MS

interface ActiveLoop {
  sessionId: string
  state: ReviewLoopState
  cancelled: boolean
  abort: AbortController
  config: ReviewLoopConfig
  prNumber?: number
  /** HEAD sha at loop start — the baseline for "did this round produce a commit". */
  startSha: string
  /** Foreground spawn context (passed through from the renderer). */
  claudeTheme?: string
  claudeConfigDir?: string
  repoPath?: string
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
  loop.abort.abort()
}

export interface StartReviewLoopLiteOptions {
  sessionId: string
  worktreePath: string
  branch: string
  baseBranch: string
  config: ReviewLoopConfig
  prNumber?: number
  /** Foreground spawn context — theme, claude account config dir, source repo. */
  claudeTheme?: string
  claudeConfigDir?: string
  repoPath?: string
}

export async function startReviewLoopLite(opts: StartReviewLoopLiteOptions): Promise<void> {
  if (activeLoops.get(opts.sessionId)?.state.status === 'running') {
    throw new Error('Review loop is already running for this session')
  }
  if (!mainWindow) {
    throw new Error('Review loop cannot start: main window unavailable')
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
    startedAt: new Date().toISOString(),
    skippedIssues: [],
  }

  const loop: ActiveLoop = {
    sessionId: opts.sessionId,
    state,
    cancelled: false,
    abort: new AbortController(),
    config,
    prNumber: opts.prNumber,
    startSha,
    claudeTheme: opts.claudeTheme,
    claudeConfigDir: opts.claudeConfigDir,
    repoPath: opts.repoPath,
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

  while (true) {
    if (loop.cancelled) return finalize(loop, 'cancelled')
    if (loop.state.iteration >= loop.config.maxIterations) return finalize(loop, 'maxIterations')

    const round = startRound(loop)

    // ── Review ──
    const review = await runReviewPhase(loop, round)
    if (!review.ok) return
    if (loop.cancelled) return finalize(loop, 'cancelled')

    // ── Triage (consumes review output) ──
    const triage = await runTriagePhase(loop, round, review.output)
    if (!triage.ok) return
    if (loop.cancelled) return finalize(loop, 'cancelled')

    // ── Fix (consumes triage output) ──
    const fix = await runFixPhase(loop, round, triage.output)
    if (!fix.ok) return
    if (loop.cancelled) return finalize(loop, 'cancelled')

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

function newSlot(phase: ReviewLoopPhaseSlot['phase']): ReviewLoopPhaseSlot {
  return { phase, status: 'pending' }
}

function startRound(loop: ActiveLoop): ReviewLoopRound {
  loop.state.iteration += 1
  const round: ReviewLoopRound = {
    index: loop.state.iteration,
    startedAt: new Date().toISOString(),
    phase: 'idle',
    phaseSlots: [newSlot('review'), newSlot('triage'), newSlot('fix')],
    rawIssues: [],
    triaged: [],
    log: [],
  }
  loop.state.rounds.push(round)
  emitState(loop)
  return round
}

/* ── Phases ─────────────────────────────────────────────────────────────── */

interface PhaseOutcome { ok: boolean; output: string }

async function runReviewPhase(loop: ActiveLoop, round: ReviewLoopRound): Promise<PhaseOutcome> {
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

  const result = await runPhase(loop, round, 'review', prompt)
  return finishPhase(loop, round, 'review', result, 'review phase failed')
}

async function runTriagePhase(
  loop: ActiveLoop,
  round: ReviewLoopRound,
  reviewOutput: string
): Promise<PhaseOutcome> {
  setPhase(loop, round, 'triage')
  pushLog(round, 'Triaging review output…')

  const prompt = `Below is the output from a code review I just ran on branch "${loop.state.branch}" (base: "${loop.state.baseBranch}"):

<review>
${reviewOutput}
</review>

For each of the issues listed above, use a sub-agent (Task tool) to investigate it. For each one:

- Check that the issue was introduced on this branch (not pre-existing on ${loop.state.baseBranch}).
- Check that the issue is real — not a false positive, misunderstanding, or stale finding.
- Decide what we should do, if anything. Options include fixing it now, deferring it, skipping it deliberately, or dismissing it as not a real problem.
- Explain what you'd do and why.

Present your findings to me as a markdown table with columns: Issue · Real? · Introduced here? · Decision · Reason.

Do not make any changes yet. Just show me your triaged issues.`

  const result = await runPhase(loop, round, 'triage', prompt)
  return finishPhase(loop, round, 'triage', result, 'triage phase failed')
}

async function runFixPhase(
  loop: ActiveLoop,
  round: ReviewLoopRound,
  triageOutput: string
): Promise<PhaseOutcome> {
  setPhase(loop, round, 'fix')
  pushLog(round, 'Applying fixes…')

  const prompt = `Below is the triage of a code review on branch "${loop.state.branch}":

<triage>
${triageOutput}
</triage>

Now do what you think needs doing based on the triage above. Apply the fixes that were decided on, commit the result with a clear message, and push to origin/${loop.state.branch}. If nothing needs fixing, say so and make no changes.`

  const result = await runPhase(loop, round, 'fix', prompt)
  return finishPhase(loop, round, 'fix', result, 'fix phase failed')
}

/* ── Phase-slot helpers ─────────────────────────────────────────────────── */

function slotOf(round: ReviewLoopRound, phase: ReviewLoopPhaseSlot['phase']): ReviewLoopPhaseSlot {
  let slot = round.phaseSlots.find((s) => s.phase === phase)
  if (!slot) {
    slot = newSlot(phase)
    round.phaseSlots.push(slot)
  }
  return slot
}

function markSlot(
  round: ReviewLoopRound,
  phase: ReviewLoopPhaseSlot['phase'],
  status: ReviewLoopPhaseSlot['status'],
  errorMessage?: string
): void {
  const slot = slotOf(round, phase)
  slot.status = status
  if (status === 'completed' || status === 'error' || status === 'skipped') {
    slot.endedAt = new Date().toISOString()
  }
  if (errorMessage) slot.errorMessage = errorMessage
}

async function runPhase(
  loop: ActiveLoop,
  round: ReviewLoopRound,
  phase: ReviewLoopPhaseSlot['phase'],
  prompt: string
): Promise<ForegroundPhaseResult> {
  const slot = slotOf(round, phase)
  const tabId = `review-loop:r${round.index}:${phase}`
  slot.tabId = tabId
  slot.status = 'running'
  slot.startedAt = new Date().toISOString()
  emitState(loop)

  return runForegroundPhase({
    window: mainWindow!,
    sessionId: loop.sessionId,
    worktreePath: loop.state.worktreePath,
    repoPath: loop.repoPath,
    claudeTheme: loop.claudeTheme,
    claudeConfigDir: loop.claudeConfigDir,
    tabId,
    prompt,
    autoAcceptEdits: true,
    timeoutMs: PHASE_TIMEOUT_MS,
    signal: loop.abort.signal,
    onSpawn: (terminalId) => {
      slot.terminalId = terminalId
      emitState(loop)
    },
  })
}

/** Map a phase result to slot status, finalizing the loop on error/cancel. */
function finishPhase(
  loop: ActiveLoop,
  round: ReviewLoopRound,
  phase: ReviewLoopPhaseSlot['phase'],
  result: ForegroundPhaseResult,
  failLabel: string
): PhaseOutcome {
  if (loop.cancelled) {
    markSlot(round, phase, 'skipped')
    finalize(loop, 'cancelled')
    return { ok: false, output: result.output }
  }
  if (!result.ok) {
    const msg = result.error ?? failLabel
    round.errorMessage = msg
    markSlot(round, phase, 'error', msg)
    pushLog(round, `${failLabel}: ${msg}`)
    finalize(loop, 'error', msg)
    return { ok: false, output: result.output }
  }
  markSlot(round, phase, 'completed')
  return { ok: true, output: result.output }
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
