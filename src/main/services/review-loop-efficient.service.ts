/**
 * Review Loop — Efficient variant.
 *
 * A token-frugal cousin of review-loop-lite.service.ts. The expensive part of a
 * review — the review itself — genuinely benefits from clear, unbiased context
 * every round, so each round's review still runs as a fresh headless `claude -p`
 * (stacked on the left of the panel). But triage + implementation do NOT need
 * fresh context: re-paying it every round is wasteful and throws away the
 * memory of what we already, deliberately, chose not to action.
 *
 * So this variant runs triage + fix in a SINGLE long-lived, interactive `claude`
 * terminal (the right of the panel) that persists across the whole loop:
 *
 *   round N:
 *     1. review : fresh `claude -p` reviews the diff/PR → captured output.
 *     2. triage : the review output is handed to the persistent worker
 *                 (round 1 via the spawn heredoc; later rounds pasted into the
 *                 live REPL). It triages, remembering earlier rounds. Its turn
 *                 ends on its Stop hook → "triage finished".
 *     3. fix    : the same worker is told to implement what it decided, commit,
 *                 and push. Its Stop hook ends the turn → "fix finished".
 *
 * Each worker turn advances when the persistent terminal's `Stop` hook fires
 * (routed by its fixed tab id). The worker keeps one conversation throughout, so
 * "fresh context" is spent only where it matters (the review).
 *
 * Round-level convergence is identical to Lite: if the fix turn produces no new
 * commit on HEAD, count the round "clean"; after N consecutive clean rounds,
 * stop. A trailing-commit safety net catches uncommitted leftovers.
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
import { runHeadlessPhase, DEFAULT_PHASE_TIMEOUT_MS } from './review-phase.service'
import {
  spawnTerminal,
  writeTerminal,
  killReviewLoopTerminals,
  AUTO_PERMISSION_MODE_ARGS,
} from './terminal.service'
import { onHookEvent } from './notification-server'
import { writeClaudeHookSettings } from './hook.service'
import { seedPermissions } from './permission-sync.service'

const execFileAsync = promisify(execFile)

const PHASE_TIMEOUT_MS = DEFAULT_PHASE_TIMEOUT_MS

/** Fixed tab id of the single persistent worker terminal (right panel). */
const PERSISTENT_TAB = 'review-loop:persistent'

/** Cap on review text pasted into the worker so a huge paste can't choke the PTY. */
const MAX_REVIEW_CHARS = 48 * 1024

/** xterm bracketed-paste delimiters — wrap multi-line input so the REPL takes it as one paste. */
const PASTE_START = '\x1b[200~'
const PASTE_END = '\x1b[201~'

/** Write to the PTY in chunks of this many bytes to respect its input buffer. */
const PTY_CHUNK_BYTES = 16 * 1024

interface ActiveLoop {
  sessionId: string
  state: ReviewLoopState
  cancelled: boolean
  abort: AbortController
  config: ReviewLoopConfig
  prNumber?: number
  /** True when reviewing a local PR — forces the diff-based /review path. */
  isLocalPr?: boolean
  /** HEAD sha at loop start — the baseline for "did this round produce a commit". */
  startSha: string
  /** Foreground spawn context (passed through from the renderer). */
  claudeTheme?: string
  claudeConfigDir?: string
  repoPath?: string
}

const activeLoops = new Map<string, ActiveLoop>()
let mainWindow: BrowserWindow | null = null

export function setReviewLoopEfficientWindow(w: BrowserWindow): void {
  mainWindow = w
}

export function hasReviewLoopEfficient(sessionId: string): boolean {
  return activeLoops.has(sessionId)
}

export function getReviewLoopEfficientState(sessionId: string): ReviewLoopState | null {
  return activeLoops.get(sessionId)?.state ?? null
}

export function cancelReviewLoopEfficient(sessionId: string): void {
  const loop = activeLoops.get(sessionId)
  if (!loop || loop.state.status !== 'running') return
  loop.cancelled = true
  loop.abort.abort()
}

export interface StartReviewLoopEfficientOptions {
  sessionId: string
  worktreePath: string
  branch: string
  baseBranch: string
  config: ReviewLoopConfig
  prNumber?: number
  /** True when reviewing a local PR (no GitHub PR) — forces the diff /review path. */
  isLocalPr?: boolean
  /** Foreground spawn context — theme, claude account config dir, source repo. */
  claudeTheme?: string
  claudeConfigDir?: string
  repoPath?: string
}

export async function startReviewLoopEfficient(
  opts: StartReviewLoopEfficientOptions
): Promise<void> {
  if (activeLoops.get(opts.sessionId)?.state.status === 'running') {
    throw new Error('Review loop is already running for this session')
  }
  if (!mainWindow) {
    throw new Error('Review loop cannot start: main window unavailable')
  }

  const config = { ...DEFAULT_REVIEW_LOOP_CONFIG, ...opts.config }

  // Sweep any phase terminals left over from a prior loop on this session
  // (including a stale persistent worker) before starting fresh.
  killReviewLoopTerminals(opts.sessionId)

  const startSha = await readHeadSha(opts.worktreePath)

  const state: ReviewLoopState = {
    sessionId: opts.sessionId,
    branch: opts.branch,
    baseBranch: opts.baseBranch,
    worktreePath: opts.worktreePath,
    variant: 'efficient',
    status: 'running',
    currentPhase: 'idle',
    iteration: 0,
    rounds: [],
    startedAt: new Date().toISOString(),
    skippedIssues: [],
    persistentTabId: PERSISTENT_TAB,
  }

  const loop: ActiveLoop = {
    sessionId: opts.sessionId,
    state,
    cancelled: false,
    abort: new AbortController(),
    config,
    prNumber: opts.prNumber,
    isLocalPr: opts.isLocalPr,
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

    // ── Review (fresh headless, stacked on the left) ──
    const review = await runReviewPhase(loop, round)
    if (!review.ok) return
    if (loop.cancelled) { markSlot(round, 'review', 'completed'); return finalize(loop, 'cancelled') }

    // ── Triage (persistent worker turn, consumes review output) ──
    const triagePrompt = buildTriagePrompt(loop.state.branch, loop.state.baseBranch, round.index, review.output)
    if (!(await runWorkerPhase(loop, round, 'triage', triagePrompt))) return

    // ── Fix (same worker, implements what triage decided) ──
    const fixPrompt = buildFixPrompt(loop.state.branch)
    if (!(await runWorkerPhase(loop, round, 'fix', fixPrompt))) return

    // ── Safety net: commit any uncommitted changes left over ──
    await trailingCommitIfDirty(loop, round)

    // ── Convergence check (identical to Lite: no new commit ⇒ clean) ──
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

/* ── Review phase (fresh headless) ──────────────────────────────────────── */

interface PhaseOutcome { ok: boolean; output: string }

async function runReviewPhase(loop: ActiveLoop, round: ReviewLoopRound): Promise<PhaseOutcome> {
  setPhase(loop, round, 'review')
  const slot = slotOf(round, 'review')
  slot.tabId = `review-loop:r${round.index}:review`
  slot.status = 'running'
  slot.startedAt = new Date().toISOString()
  slot.transcript = []
  emitState(loop)

  let prompt: string
  if (loop.prNumber && !loop.isLocalPr) {
    pushLog(round, `Running /review ${loop.prNumber}…`)
    prompt = `/review ${loop.prNumber}`
  } else {
    pushLog(round, `Running /review on diff ${loop.state.baseBranch}...${loop.state.branch}…`)
    const diff = await readDiff(loop.state.worktreePath, loop.state.baseBranch, loop.state.branch)
    prompt = `/review\n\nHere is the diff between this branch and its base (${loop.state.baseBranch}...${loop.state.branch}):\n\n\`\`\`diff\n${diff}\n\`\`\``
  }

  let lastEmit = 0
  const result = await runHeadlessPhase({
    sessionId: loop.sessionId,
    worktreePath: loop.state.worktreePath,
    repoPath: loop.repoPath,
    claudeTheme: loop.claudeTheme,
    claudeConfigDir: loop.claudeConfigDir,
    prompt,
    timeoutMs: PHASE_TIMEOUT_MS,
    signal: loop.abort.signal,
    onTranscript: (line) => {
      const lines = slot.transcript!
      lines.push(line)
      if (lines.length > 800) lines.splice(0, lines.length - 800)
      const now = Date.now()
      if (now - lastEmit > 200) {
        lastEmit = now
        emitState(loop)
      }
    },
  })

  if (loop.cancelled) {
    markSlot(round, 'review', 'skipped')
    finalize(loop, 'cancelled')
    return { ok: false, output: result.output }
  }
  if (!result.ok) {
    const msg = result.error ?? 'review phase failed'
    round.errorMessage = msg
    markSlot(round, 'review', 'error', msg)
    pushLog(round, `review phase failed: ${msg}`)
    finalize(loop, 'error', msg)
    return { ok: false, output: result.output }
  }
  markSlot(round, 'review', 'completed')
  return { ok: true, output: result.output }
}

/* ── Worker phases (persistent interactive terminal) ────────────────────── */

/**
 * Run one turn of the persistent worker (triage or fix). On the very first
 * worker turn of the loop this spawns the persistent terminal with the prompt
 * as its heredoc; on every later turn it pastes the prompt into the live REPL.
 * Either way it waits for the worker's next Stop hook. Returns false (and
 * finalizes the loop) on failure/cancel.
 */
async function runWorkerPhase(
  loop: ActiveLoop,
  round: ReviewLoopRound,
  phase: 'triage' | 'fix',
  prompt: string
): Promise<boolean> {
  setPhase(loop, round, phase)
  const slot = slotOf(round, phase)
  slot.tabId = PERSISTENT_TAB
  slot.status = 'running'
  slot.startedAt = new Date().toISOString()
  pushLog(round, phase === 'triage' ? 'Triaging review output…' : 'Implementing triage decisions…')
  emitState(loop)

  const result = await runWorkerTurn(loop, prompt)

  if (loop.cancelled) {
    markSlot(round, phase, 'skipped')
    finalize(loop, 'cancelled')
    return false
  }
  if (!result.ok) {
    const msg = result.error ?? `${phase} phase failed`
    round.errorMessage = msg
    markSlot(round, phase, 'error', msg)
    pushLog(round, `${phase} phase failed: ${msg}`)
    finalize(loop, 'error', msg)
    return false
  }
  markSlot(round, phase, 'completed')
  return true
}

interface TurnResult { ok: boolean; error?: string }

/**
 * Deliver `prompt` to the persistent worker and resolve when its next Stop hook
 * fires (or on timeout / abort). We subscribe to the hook stream BEFORE
 * injecting so a fast turn can't fire Stop before we're listening.
 */
function runWorkerTurn(loop: ActiveLoop, prompt: string): Promise<TurnResult> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (ok: boolean, error?: string): void => {
      if (settled) return
      settled = true
      unsubscribe()
      clearTimeout(timer)
      loop.abort.signal.removeEventListener('abort', onAbort)
      resolve({ ok, error })
    }

    // The worker turn ends when the persistent tab fires a Stop. terminal.service
    // also synthesises a Stop if the claude PTY exits, so a crash resolves us too.
    const unsubscribe = onHookEvent((evt) => {
      if (evt.contextId !== loop.sessionId || evt.tabId !== PERSISTENT_TAB) return
      if (evt.hookType !== 'stop') return
      finish(true)
    })

    const timer = setTimeout(() => {
      finish(false, `worker turn timed out after ${Math.round(PHASE_TIMEOUT_MS / 60000)}m`)
    }, PHASE_TIMEOUT_MS)

    const onAbort = (): void => finish(false, 'cancelled')
    if (loop.abort.signal.aborted) {
      finish(false, 'cancelled')
      return
    }
    loop.abort.signal.addEventListener('abort', onAbort, { once: true })

    try {
      if (loop.state.persistentTerminalId) {
        // Live REPL already running — paste the prompt in.
        injectPrompt(loop.state.persistentTerminalId, prompt)
      } else {
        // First worker turn of the loop — spawn the persistent terminal with the
        // prompt as its heredoc (clean multi-line delivery, no bracketed paste).
        spawnPersistentWorker(loop, prompt)
      }
    } catch (err) {
      finish(false, err instanceof Error ? err.message : String(err))
    }
  })
}

/** Spawn the single persistent interactive worker terminal with its first prompt. */
function spawnPersistentWorker(loop: ActiveLoop, initialPrompt: string): void {
  // Seed the worktree hooks (so Stop fires) + inherited permission allowlist,
  // mirroring runForegroundPhase. Non-fatal on failure.
  try {
    writeClaudeHookSettings(loop.state.worktreePath, loop.claudeTheme ?? 'dark', loop.sessionId)
  } catch {
    /* a missing Stop hook only means we fall back to the timeout */
  }
  if (loop.repoPath) {
    try {
      seedPermissions(loop.repoPath, loop.state.worktreePath)
    } catch {
      /* non-fatal */
    }
  }

  const terminalId = spawnTerminal(
    mainWindow!,
    loop.sessionId,
    loop.state.worktreePath,
    'claude',
    loop.claudeTheme ?? 'dark',
    loop.claudeConfigDir,
    initialPrompt,
    loop.repoPath,
    false,
    loop.sessionId, // contextId — routes the Stop hook back to this session
    PERSISTENT_TAB,
    AUTO_PERMISSION_MODE_ARGS // auto mode — never bypass / acceptEdits
  )
  loop.state.persistentTerminalId = terminalId
  emitState(loop)
}

/** Wrap text as a single bracketed paste and submit it (trailing Enter). */
export function wrapBracketedPaste(text: string): string {
  return `${PASTE_START}${text}${PASTE_END}\r`
}

/** Paste a prompt into the live worker REPL, chunked to respect the PTY input buffer. */
function injectPrompt(terminalId: string, prompt: string): void {
  const payload = wrapBracketedPaste(prompt)
  for (let i = 0; i < payload.length; i += PTY_CHUNK_BYTES) {
    writeTerminal(terminalId, payload.slice(i, i + PTY_CHUNK_BYTES))
  }
}

/* ── Prompt builders (pure) ─────────────────────────────────────────────── */

/** Cap the review text embedded in the triage prompt, noting any truncation. */
export function clampReview(reviewOutput: string): string {
  if (reviewOutput.length <= MAX_REVIEW_CHARS) return reviewOutput
  return (
    `…(review truncated to the last ${MAX_REVIEW_CHARS} characters)…\n` +
    reviewOutput.slice(-MAX_REVIEW_CHARS)
  )
}

export function buildTriagePrompt(
  branch: string,
  baseBranch: string,
  roundIndex: number,
  reviewOutput: string
): string {
  return `Round ${roundIndex}. Below is a FRESH code review of branch "${branch}" (base: "${baseBranch}"). You have full memory of earlier rounds in this conversation, so do NOT re-open issues you already deliberately skipped or deferred — focus on what's new or still outstanding.

<review>
${clampReview(reviewOutput)}
</review>

For each issue above, investigate it (use a sub-agent / the Task tool where it helps). For each one:

- Check it was introduced on this branch, not pre-existing on ${baseBranch}.
- Check it's real — not a false positive, misunderstanding, or stale finding.
- Decide what to do: fix it now, defer it, deliberately skip it, or dismiss it as not a real problem.

Present your findings as a markdown table with columns: Issue · Real? · Introduced here? · Decision · Reason.

Do not make any changes yet — just show me the triaged table.`
}

export function buildFixPrompt(branch: string): string {
  return `Now implement what you decided in the triage above: apply the fixes, commit the result with a clear message, and push to origin/${branch}. If nothing needs fixing, say so and make no changes.`
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

/* ── Safety net + git helpers ───────────────────────────────────────────── */

async function trailingCommitIfDirty(loop: ActiveLoop, round: ReviewLoopRound): Promise<void> {
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: loop.state.worktreePath })
    if (!stdout.trim()) return
    pushLog(round, 'Worktree has uncommitted changes after fix turn — making a trailing commit.')
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

  // Sweep the persistent worker PTY (and any stragglers). killTerminal marks the
  // instance stopped first, so its exit does NOT synthesise a stray Stop event.
  killReviewLoopTerminals(loop.sessionId)

  activeLoops.delete(loop.sessionId)
}
