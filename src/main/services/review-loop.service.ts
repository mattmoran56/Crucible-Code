/**
 * Review Loop orchestrator.
 *
 * Drives a 3-phase cycle (review → triage → fix) by spawning headless `claude`
 * subprocesses with curated prompts. Stops on convergence (N consecutive clean
 * rounds), iteration cap, cost cap, or manual cancel. After the loop ends, any
 * skipped/deferred issues are summarized in a sticky PR comment so reviewers
 * can see what was knowingly left undone.
 */
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { IPC } from '../../shared/constants'
import {
  DEFAULT_REVIEW_LOOP_CONFIG,
  type ReviewLoopConfig,
  type ReviewLoopIssue,
  type ReviewLoopPhase,
  type ReviewLoopRound,
  type ReviewLoopState,
  type ReviewLoopStopReason,
  type ReviewLoopTriagedIssue,
} from '../../shared/types'
import { killChildTree, runHeadlessClaude, DEFAULT_PHASE_TIMEOUT_MS } from './claude-headless.service'

const execFileAsync = promisify(execFile)

const STICKY_MARKER = '<!-- crucible-review-loop -->'

const PHASE_TIMEOUT_MS = DEFAULT_PHASE_TIMEOUT_MS

interface ActiveLoop {
  sessionId: string
  state: ReviewLoopState
  cancelled: boolean
  child?: ChildProcessWithoutNullStreams
  config: ReviewLoopConfig
  prNumber?: number
  loopDir: string
}

const activeLoops = new Map<string, ActiveLoop>()
let mainWindow: BrowserWindow | null = null

export function setReviewLoopWindow(w: BrowserWindow): void {
  mainWindow = w
}

export function getReviewLoopState(sessionId: string): ReviewLoopState | null {
  return activeLoops.get(sessionId)?.state ?? null
}

export function isReviewLoopActive(sessionId: string): boolean {
  return activeLoops.get(sessionId)?.state.status === 'running'
}

export function cancelReviewLoop(sessionId: string): void {
  const loop = activeLoops.get(sessionId)
  if (!loop || loop.state.status !== 'running') return
  loop.cancelled = true
  if (loop.child) killChildTree(loop.child)
}

export interface StartReviewLoopOptions {
  sessionId: string
  worktreePath: string
  branch: string
  baseBranch: string
  config: ReviewLoopConfig
  prNumber?: number
}

export async function startReviewLoop(opts: StartReviewLoopOptions): Promise<void> {
  if (activeLoops.get(opts.sessionId)?.state.status === 'running') {
    throw new Error('Review loop is already running for this session')
  }

  const config = { ...DEFAULT_REVIEW_LOOP_CONFIG, ...opts.config }
  const loopDir = join(opts.worktreePath, '.crucible', 'review-loop')
  await mkdir(loopDir, { recursive: true })

  const state: ReviewLoopState = {
    sessionId: opts.sessionId,
    branch: opts.branch,
    baseBranch: opts.baseBranch,
    worktreePath: opts.worktreePath,
    variant: 'pro',
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
    loopDir,
  }
  activeLoops.set(opts.sessionId, loop)
  emitState(loop)

  // Run loop async; surface any unexpected errors via state.
  void runLoop(loop).catch((err: unknown) => {
    finalize(loop, 'error', err instanceof Error ? err.message : String(err))
  })
}

/** Drive the review/triage/fix cycle until a stop condition fires. */
async function runLoop(loop: ActiveLoop): Promise<void> {
  let consecutiveClean = 0

  // Re-check the cost cap between phases so a round that starts under the
  // cap can't blow several dollars past it across review→triage→fix before
  // the next loop iteration runs.
  const costCapTripped = (): boolean =>
    loop.state.cumulativeCostUsd >= loop.config.costCapUsd

  while (true) {
    if (loop.cancelled) return finalize(loop, 'cancelled')

    if (loop.state.iteration >= loop.config.maxIterations) {
      return finalize(loop, 'maxIterations')
    }
    if (costCapTripped()) {
      return finalize(loop, 'costCap')
    }

    const round = startRound(loop)

    const reviewOk = await runReviewPhase(loop, round)
    if (!reviewOk) return // finalize already called by phase
    if (loop.cancelled) return finalize(loop, 'cancelled')
    if (costCapTripped()) return finalize(loop, 'costCap')

    const triageOk = await runTriagePhase(loop, round)
    if (!triageOk) return
    if (loop.cancelled) return finalize(loop, 'cancelled')
    if (costCapTripped()) return finalize(loop, 'costCap')

    const actionable = round.triaged.filter((i) => i.decision === 'fix').length

    if (actionable > 0) {
      consecutiveClean = 0
      const fixOk = await runFixPhase(loop, round)
      if (!fixOk) return
      if (loop.cancelled) return finalize(loop, 'cancelled')
      if (costCapTripped()) return finalize(loop, 'costCap')
    } else {
      consecutiveClean += 1
      pushLog(round, `No fixable issues in this round (${consecutiveClean} clean ${consecutiveClean === 1 ? 'round' : 'rounds'} so far).`)
    }

    // Track skipped/deferred for the sticky PR comment.
    for (const t of round.triaged) {
      if (t.decision === 'skip' || t.decision === 'defer') {
        loop.state.skippedIssues.push(t)
      }
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
  pushLog(round, `Reviewing diff between ${loop.state.branch} and ${loop.state.baseBranch}…`)

  const issuesPath = join(loop.loopDir, `round-${round.index}-issues.json`)

  // Remove any stale issues file from a prior run before invoking claude so we
  // can later assert that this run actually wrote it. Otherwise a model
  // refusal / silent tool error / partial output produces an empty array that
  // is indistinguishable from a clean review and drives a false 'converged'.
  try {
    await unlink(issuesPath)
  } catch {
    // Not present — fine.
  }

  const prompt = buildReviewPrompt({
    branch: loop.state.branch,
    baseBranch: loop.state.baseBranch,
    issuesPath,
  })

  const result = await runClaude(loop, round, prompt)
  round.costUsd += result.costUsd
  loop.state.cumulativeCostUsd += result.costUsd

  if (loop.cancelled) return false
  if (!result.ok) {
    round.errorMessage = result.error ?? 'review phase failed'
    pushLog(round, `Review phase failed: ${round.errorMessage}`)
    finalize(loop, 'error', round.errorMessage)
    return false
  }

  // The claude run must have produced the issues file; an empty array is a
  // legitimate outcome only when the file exists.
  if (!existsSync(issuesPath)) {
    round.errorMessage = 'review phase did not write issues file'
    pushLog(round, `Review phase failed: ${round.errorMessage}`)
    finalize(loop, 'error', round.errorMessage)
    return false
  }

  const issues = await readJsonSafe<ReviewLoopIssue[]>(issuesPath, [])
  round.rawIssues = Array.isArray(issues) ? issues : []
  pushLog(round, `Review found ${round.rawIssues.length} candidate ${round.rawIssues.length === 1 ? 'issue' : 'issues'}.`)
  emitState(loop)
  return true
}

async function runTriagePhase(loop: ActiveLoop, round: ReviewLoopRound): Promise<boolean> {
  setPhase(loop, round, 'triage')

  if (round.rawIssues.length === 0) {
    pushLog(round, 'No issues to triage; skipping.')
    return true
  }

  const issuesPath = join(loop.loopDir, `round-${round.index}-issues.json`)
  const triagePath = join(loop.loopDir, `round-${round.index}-triage.json`)
  const prompt = buildTriagePrompt({
    branch: loop.state.branch,
    baseBranch: loop.state.baseBranch,
    issuesPath,
    triagePath,
  })

  pushLog(round, `Triaging ${round.rawIssues.length} ${round.rawIssues.length === 1 ? 'issue' : 'issues'} (one sub-agent each)…`)
  const result = await runClaude(loop, round, prompt)
  round.costUsd += result.costUsd
  loop.state.cumulativeCostUsd += result.costUsd

  if (loop.cancelled) return false
  if (!result.ok) {
    round.errorMessage = result.error ?? 'triage phase failed'
    pushLog(round, `Triage phase failed: ${round.errorMessage}`)
    finalize(loop, 'error', round.errorMessage)
    return false
  }

  const triaged = await readJsonSafe<ReviewLoopTriagedIssue[]>(triagePath, [])
  round.triaged = Array.isArray(triaged) ? triaged : []
  const fixCount = round.triaged.filter((t) => t.decision === 'fix').length
  const skipCount = round.triaged.filter((t) => t.decision === 'skip' || t.decision === 'defer').length
  pushLog(round, `Triage complete: ${fixCount} to fix, ${skipCount} skipped/deferred.`)
  emitState(loop)
  return true
}

async function runFixPhase(loop: ActiveLoop, round: ReviewLoopRound): Promise<boolean> {
  setPhase(loop, round, 'fix')
  const triagePath = join(loop.loopDir, `round-${round.index}-triage.json`)

  // Restrict the fix prompt to only the files flagged for fixing in this
  // round's triage. The fix phase runs with --dangerously-skip-permissions
  // and auto-pushes, so without this scope an over-eager run could ship
  // collateral edits upstream.
  const allowedFiles = Array.from(
    new Set(
      round.triaged
        .filter((t) => t.decision === 'fix' && typeof t.file === 'string' && t.file.trim())
        .map((t) => t.file as string)
    )
  )

  const prompt = buildFixPrompt({
    branch: loop.state.branch,
    triagePath,
    allowedFiles,
  })

  pushLog(round, 'Applying fixes, committing, and pushing…')
  const result = await runClaude(loop, round, prompt)
  round.costUsd += result.costUsd
  loop.state.cumulativeCostUsd += result.costUsd

  if (loop.cancelled) return false
  if (!result.ok) {
    round.errorMessage = result.error ?? 'fix phase failed'
    pushLog(round, `Fix phase failed: ${round.errorMessage}`)
    finalize(loop, 'error', round.errorMessage)
    return false
  }
  pushLog(round, 'Fix phase complete.')
  return true
}

/* ── Prompt builders ────────────────────────────────────────────────────── */

function buildReviewPrompt(o: { branch: string; baseBranch: string; issuesPath: string }): string {
  return `You are reviewing the diff between branch "${o.branch}" and its base "${o.baseBranch}".

Run \`git diff ${o.baseBranch}...${o.branch}\` to inspect what changed. Focus on issues introduced in this branch: bugs, regressions, security problems, broken invariants, missed edge cases, and incorrect or misleading code.

Write your findings as a JSON array to "${o.issuesPath}" using this schema:

[
  {
    "id": "string-stable-id-per-issue",
    "title": "short summary",
    "description": "what's wrong and why it matters",
    "file": "path/relative/to/repo",
    "line": 42,
    "category": "bug | security | regression | logic | style | doc | test"
  }
]

Rules:
- Only include real, concrete issues. Skip stylistic nits unless they materially harm readability.
- One JSON array, valid JSON, no markdown wrapper. If there are no issues, write [].
- Write the file before exiting.`
}

function buildTriagePrompt(o: {
  branch: string
  baseBranch: string
  issuesPath: string
  triagePath: string
}): string {
  return `Triage the candidate issues in "${o.issuesPath}" for the branch "${o.branch}" (base: "${o.baseBranch}").

For EACH issue, spawn a sub-agent (Task tool) that:
1. Inspects the relevant code in the worktree.
2. Determines whether the issue was introduced by this branch (vs. pre-existing on ${o.baseBranch}).
3. Decides one of:
   - "fix"   — should be fixed in this branch now
   - "defer" — real issue, but out of scope for this branch (will be mentioned on the PR)
   - "skip"  — real issue or trade-off we are deliberately choosing not to fix in this branch
               (e.g. accepted limitation, conscious design decision, scope cut). Will be mentioned on the PR.
   - "noop"  — NOT a real problem: false positive, duplicate, stale, pre-existing on the base branch,
               or you cannot confirm it is real. These are NOT mentioned on the PR.
4. Writes a short justification (1-3 sentences).

Aggregate the sub-agent verdicts and write the result as a JSON array to "${o.triagePath}" using this schema:

[
  {
    "id": "<same id from input>",
    "title": "...",
    "description": "...",
    "file": "...",
    "line": 42,
    "category": "...",
    "introducedInPR": true,
    "decision": "fix" | "skip" | "defer" | "noop",
    "justification": "..."
  }
]

Rules:
- Output a single valid JSON array, no markdown wrapper.
- The PR comment will list ONLY "skip" and "defer" items — these are explicit decisions or recognised
  trade-offs reviewers should be aware of. Do NOT use "skip"/"defer" for false positives or unconfirmed
  issues; use "noop" instead so they are excluded from the PR comment.
- If decision is "skip" or "defer", the justification MUST clearly explain the trade-off / why we are
  consciously not fixing it (it will be posted on the PR).
- Be conservative: if you cannot confirm an issue was introduced by this branch and is real, mark it
  "noop" (not "skip"), with a brief justification.
- Write the file before exiting.`
}

function buildFixPrompt(o: { branch: string; triagePath: string; allowedFiles: string[] }): string {
  const fileList = o.allowedFiles.length > 0
    ? o.allowedFiles.map((f) => `  - ${f}`).join('\n')
    : '  (none — exit without changes)'
  return `Apply the fixes listed in "${o.triagePath}" (only those with decision === "fix").

You may ONLY modify files in this allowlist (the exact set the triage flagged for fixing this round):
${fileList}

If a fix cannot be applied without editing a file outside the allowlist, leave that fix unapplied and continue with the rest. Do NOT touch any other file (including .crucible/, lockfiles, settings, screenshots, or unrelated source). The single commit produced by this phase must contain only edits to allowlisted paths.

For each fix:
1. Make the necessary code changes in the worktree.
2. Keep the diff minimal — do not refactor unrelated code.
3. After all fixes are applied, stage everything, create ONE commit with a clear message summarizing the round (e.g. "review-loop: fix N issues from round X"), and push to origin/${o.branch}.

If you cannot safely apply a fix, leave it untouched and continue with the rest. Do not delete or rewrite unrelated files. Do not amend previous commits.`
}

/* ── Claude subprocess runner ───────────────────────────────────────────── */

interface ClaudeResult {
  ok: boolean
  costUsd: number
  error?: string
}

/**
 * Run claude in headless mode with the given prompt piped on stdin.
 * Uses --output-format stream-json so each assistant message and tool call
 * arrives as an NDJSON event; we parse them into human-readable transcript
 * lines on the round so the UI can show live progress.
 */
async function runClaude(loop: ActiveLoop, round: ReviewLoopRound, prompt: string): Promise<ClaudeResult> {
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
    return { ok: false, costUsd: result.costUsd, error: result.error }
  }
  return { ok: true, costUsd: result.costUsd }
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

async function readJsonSafe<T>(filePath: string, fallback: T): Promise<T> {
  try {
    if (!existsSync(filePath)) return fallback
    const raw = await readFile(filePath, 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/* ── Finalize + PR comment ──────────────────────────────────────────────── */

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

  // Drop the loop from the active-set so completed runs don't accumulate
  // (rounds, transcripts, raw issues) in memory for the lifetime of the app.
  // The renderer already received the final state via emitState above and
  // caches it locally; refreshState handles a missing entry gracefully.
  activeLoops.delete(loop.sessionId)

  // Best-effort PR comment for skipped/deferred issues.
  void writeStickyPRComment(loop).catch(() => {
    // Non-fatal — already finalized.
  })
}

async function writeStickyPRComment(loop: ActiveLoop): Promise<void> {
  if (!loop.prNumber) return
  if (loop.state.skippedIssues.length === 0) return

  const body = renderStickyComment(loop.state)
  const repoPath = loop.state.worktreePath

  // Find existing sticky comment.
  let existingId: number | undefined
  try {
    const { stdout } = await execFileAsync(
      'gh',
      ['api', `repos/{owner}/{repo}/issues/${loop.prNumber}/comments`, '--paginate'],
      { cwd: repoPath, maxBuffer: 5 * 1024 * 1024 }
    )
    const parsed = JSON.parse(stdout) as Array<{ id: number; body: string }>
    const sticky = parsed.find((c) => c.body.includes(STICKY_MARKER))
    existingId = sticky?.id
  } catch {
    // Fallthrough — we'll post a new comment.
  }

  try {
    if (existingId != null) {
      await execFileAsync(
        'gh',
        [
          'api',
          '-X', 'PATCH',
          `repos/{owner}/{repo}/issues/comments/${existingId}`,
          '-f', `body=${body}`,
        ],
        { cwd: repoPath }
      )
    } else {
      await execFileAsync(
        'gh',
        [
          'pr', 'comment', String(loop.prNumber),
          '--body', body,
        ],
        { cwd: repoPath }
      )
    }
  } catch {
    // Best-effort — don't crash the loop on comment failure.
  }
}

function renderStickyComment(state: ReviewLoopState): string {
  const lines: string[] = [
    STICKY_MARKER,
    '## Review Loop — issues left open',
    '',
    `_Generated by the Crucible Code review loop on branch \`${state.branch}\` (base: \`${state.baseBranch}\`)._`,
    '',
  ]

  // De-dupe by id with a precedence rule: 'defer' (real but out of scope)
  // outranks 'skip' (false positive / accepted), so a later 'skip' for the
  // same id never overwrites an earlier 'defer'. For equal precedence the
  // most recent occurrence wins so the latest justification surfaces.
  const rank = (d: ReviewLoopTriagedIssue['decision']): number =>
    d === 'defer' ? 2 : d === 'skip' ? 1 : 0
  const byId = new Map<string, ReviewLoopTriagedIssue>()
  for (const issue of state.skippedIssues) {
    const existing = byId.get(issue.id)
    if (!existing || rank(issue.decision) >= rank(existing.decision)) {
      byId.set(issue.id, issue)
    }
  }
  const skipped = [...byId.values()]

  lines.push(
    `The loop ran for ${state.iteration} ${state.iteration === 1 ? 'round' : 'rounds'} and chose not to fix the following ${skipped.length} ${skipped.length === 1 ? 'item' : 'items'}:`,
    ''
  )
  for (const i of skipped) {
    const loc = i.file ? ` — \`${i.file}${i.line ? `:${i.line}` : ''}\`` : ''
    lines.push(`### ${i.decision === 'defer' ? '⏭ Deferred' : '↷ Skipped'}: ${i.title}${loc}`)
    lines.push('')
    lines.push(`**Reason:** ${i.justification || '_(none provided)_'}`)
    if (i.description) {
      lines.push('')
      lines.push(`<details><summary>Original finding</summary>\n\n${i.description}\n\n</details>`)
    }
    lines.push('')
  }
  return lines.join('\n')
}
