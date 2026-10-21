/**
 * Teleport: pull a cloud session down into its worktree, then hand it to the
 * visual agent.
 *
 * `claude --teleport <id>` runs in a PTY in the session's Agent tab. The
 * renderer shows a "Teleporting…" progress view over it, built from the steps
 * the CLI prints (`progressStepsIn`); if the CLI stops to ask something (stash,
 * repo checkout, sign-in, workspace trust) the run goes to `needs-input` and
 * the terminal is revealed so the user can answer.
 *
 * Why a PTY and not the visual agent's `-p` stream-json argv: the CLI does
 * accept `--teleport` in print mode (2.1.306 has a `tengu_teleport_print`
 * branch), but there it fails hard on anything it would otherwise ask about
 * and reports failures only to its debug log.
 *
 * Completion: we poll for the teleported transcript (findTeleportTranscript:
 * newest `.jsonl` since the start that carries a teleport marker). Once it is
 * there and has stopped growing, the REPL is closed (Ctrl-C twice, then a
 * kill) and the run is `done` with the local Claude session id; the renderer
 * resumes it as a visual agent (`--resume <id>`).
 *
 * BUT (verified in the 2.1.306 binary): the interactive REPL hands the pulled
 * rows to its transcript recorder as the *restored* conversation, and the
 * recorder skips restored messages (`ignore: isAsRestored(...)`) — so nothing
 * is written to `<config>/projects/<encoded cwd>/` until the conversation
 * changes, i.e. the user's first message. Waiting on the transcript alone
 * therefore hangs forever. We also watch the PTY for the REPL being up
 * ("Session resumed", its "? for shortcuts" footer); if it is up and no
 * transcript shows within TELEPORT_TRANSCRIPT_WAIT_MS the run goes to
 * `needs-input` / `first-message` with the terminal revealed. Any run with no
 * progress for TELEPORT_STALL_MS goes to `needs-input` / `timeout`. Neither
 * ever closes the REPL on its own once the user may be typing in it.
 *
 * PERMISSIONS: argv from teleportArgv, which spreads the empty
 * AUTO_PERMISSION_MODE_ARGS — never bypass, never --permission-mode.
 */
import type { BrowserWindow } from 'electron'
import { IPC } from '../../shared/constants'
import type { CloudTeleportState } from '../../shared/types'
import * as terminalService from './terminal.service'
import {
  claudeShellCommand,
  findTeleportTranscript,
  stripAnsi,
  summarizeCreateFailure,
  teleportArgv,
  type TeleportTranscript,
} from './cloud-session.service'

/** The Agent tab id the teleport PTY reports under. */
export const TELEPORT_PTY_TAB = 'agent'

/** How often to look for the teleported transcript. */
export const TELEPORT_POLL_MS = 1_000
/** After the REPL is up, how long to wait for its transcript before handing over to the user. */
export const TELEPORT_TRANSCRIPT_WAIT_MS = 8_000
/** With no step, prompt or REPL seen for this long, show the terminal and offer a way out. */
export const TELEPORT_STALL_MS = 120_000
/** How long the REPL gets to exit after Ctrl-C before it is killed. */
export const TELEPORT_EXIT_WAIT_MS = 4_000

const OUTPUT_CAP = 64 * 1024

/* --- reading the PTY (pure) ------------------------------------------------ */

/**
 * The CLI's teleport progress view (2.1.306, verified in the binary) lists
 * all four steps from its first frame — ◯ for steps not reached, a spinner
 * (◐◓◑◒) on the current one, ✔ on finished ones — so a label alone says
 * nothing; only a label drawn with a spinner or a tick has been reached.
 */
const STEPS: Array<{ label: string }> = [
  { label: 'Validating session' },
  { label: 'Fetching session logs' },
  { label: 'Getting branch info' },
  { label: 'Checking out branch' },
]
/** The step label Session-resumed is reported under (TeleportProgress maps it). */
export const SESSION_RESUMED_STEP = 'Session resumed'

/** ✔/✓/√ (done) or ◐◓◑◒ (current), then a few non-letters (spaces, the cleared colour codes). */
const REACHED_MARK = '[✔✓√◐◓◑◒][^A-Za-z\\n]{0,6}'
const reachedRe = (label: string): RegExp => new RegExp(`${REACHED_MARK}${label.replace(/ /g, '\\s*')}`, 'i')

/**
 * The REPL is up with the teleported conversation loaded: its "Session
 * resumed" notice, the bridge notice, or the prompt footer. Spaces are
 * optional because cursor moves between words are stripped.
 */
const READY: RegExp[] = [
  /Session\s*resumed/i,
  /its\s*own\s*copy\s*of\s*the\s*session/i,
  /\?\s*for\s*shortcuts/i,
]

/** The CLI is waiting for the user (dialogs and menus it may show). */
const PROMPTS: RegExp[] = [
  /Would you like to stash these changes/i,
  /Stash changes and continue/i,
  /Teleport requires a Claude\.ai account/i,
  /You must run claude --teleport/i,
  /Select a session to resume/i,
  /Do you trust the files in this folder/i,
  /Press Enter to continue/i,
  /\(y\/n\)/i,
  /❯\s*\d+\.\s/,
]

/** The steps reached so far (drawn with a spinner or a tick), in CLI order, each once. */
export function progressStepsIn(text: string): string[] {
  const plain = stripAnsi(text)
  const steps = STEPS.filter((s) => reachedRe(s.label).test(plain)).map((s) => s.label)
  // A later step reached means the earlier ones are done even if their ticks
  // were drawn in a frame we only saw part of.
  const furthest = STEPS.findIndex((s) => s.label === steps.at(-1))
  const all = furthest < 0 ? [] : STEPS.slice(0, furthest + 1).map((s) => s.label)
  return replReadyIn(plain) ? [...all, SESSION_RESUMED_STEP] : all
}

/** The REPL is up with the teleported conversation (see READY). */
export const replReadyIn = (text: string): boolean => {
  const plain = stripAnsi(text)
  return READY.some((re) => re.test(plain))
}
/** @deprecated name kept for callers; same as replReadyIn. */
export const sessionResumedIn = replReadyIn

const lastIndexOf = (text: string, patterns: RegExp[]): number => {
  let last = -1
  for (const re of patterns) {
    const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)
    for (const m of text.matchAll(global)) last = Math.max(last, m.index ?? -1)
  }
  return last
}

/**
 * Whether the CLI is (still) asking something: a prompt appeared and no
 * progress followed it. Dialogs redraw while shown, so the newest prompt is
 * compared with the newest progress line / REPL marker.
 */
export function awaitingInputIn(text: string): boolean {
  const plain = stripAnsi(text)
  const prompt = lastIndexOf(plain, PROMPTS)
  if (prompt < 0) return false
  return prompt > lastIndexOf(plain, [...STEPS.map((s) => new RegExp(s.label, 'i')), ...READY])
}

/* --- runs ------------------------------------------------------------------ */

export interface StartTeleportOptions {
  sessionId: string
  projectId?: string
  worktreePath: string
  cloudSessionId: string
  configDir?: string | null
  repoPath?: string
  claudeTheme?: string
}

interface Run {
  state: CloudTeleportState
  opts: StartTeleportOptions
  window: BrowserWindow
  output: string
  /** When the REPL was first seen up (READY). */
  readyAt: number | null
  /** Last time the PTY showed progress (a new step, a prompt, the REPL). */
  progressAt: number
  lastSize: number | null
  poll: ReturnType<typeof setInterval> | null
  unwatch?: () => void
  polling: boolean
  exited: boolean
  /** The user asked to leave the terminal (finishTeleport). */
  userFinished: boolean
  /**
   * The REPL was handed to the user (first-message): from here the run never
   * closes the terminal on its own — they may be mid-turn in it.
   */
  handedOver: boolean
}

const runs = new Map<string, Run>()

const snapshot = (run: Run): CloudTeleportState => ({ ...run.state, steps: [...run.state.steps] })

function emit(run: Run): void {
  const win = run.window
  if (win && !win.isDestroyed?.()) win.webContents?.send(IPC.CLOUD_SESSION_TELEPORT_EVENT, snapshot(run))
}

const live = (run: Run): boolean => runs.get(run.state.sessionId) === run

function update(run: Run, patch: Partial<CloudTeleportState>): void {
  const next = { ...run.state, ...patch }
  if (next.status !== 'needs-input') delete next.waiting
  const changed =
    next.status !== run.state.status ||
    next.waiting !== run.state.waiting ||
    next.error !== run.state.error ||
    next.claudeSessionId !== run.state.claudeSessionId ||
    next.steps.join('\n') !== run.state.steps.join('\n')
  run.state = next
  if (changed) emit(run)
}

function stopPolling(run: Run): void {
  if (run.poll) clearInterval(run.poll)
  run.poll = null
}

export function getTeleportState(sessionId: string): CloudTeleportState | null {
  const run = runs.get(sessionId)
  return run ? snapshot(run) : null
}

/** Forget a run (session removed). Does not kill the PTY; killSessionTerminals does. */
export function forgetTeleport(sessionId: string): void {
  const run = runs.get(sessionId)
  if (!run) return
  stopPolling(run)
  run.unwatch?.()
  runs.delete(sessionId)
}

const transcriptOf = (run: Run): Promise<TeleportTranscript | null> =>
  findTeleportTranscript({ worktreePath: run.opts.worktreePath, configDir: run.opts.configDir, since: run.state.startedAt })

/** Close the REPL politely (Ctrl-C twice), then kill it if it lingers. */
function closePty(run: Run): void {
  const id = run.state.terminalId
  try {
    terminalService.writeTerminal(id, '\x03')
    setTimeout(() => {
      if (!run.exited) terminalService.writeTerminal(id, '\x03')
    }, 250)
  } catch {
    // Already gone.
  }
  setTimeout(() => {
    if (!run.exited) terminalService.killTerminal(id)
  }, TELEPORT_EXIT_WAIT_MS)
}

/** The conversation is local (or the user asked to leave): close the PTY; `done` follows on its exit. */
function finish(run: Run): void {
  if (run.state.status === 'finishing' || run.state.status === 'done') return
  stopPolling(run)
  update(run, { status: 'finishing' })
  closePty(run)
}

async function settle(run: Run, code: number): Promise<void> {
  const found = await transcriptOf(run).catch(() => null)
  if (!live(run)) return
  const sure = !!found && (found.marked || run.readyAt !== null || run.state.status === 'finishing')
  if (found && sure) {
    update(run, { status: 'done', claudeSessionId: found.id, error: undefined })
    return
  }
  if (run.userFinished) {
    // The user chose the Agent view without a saved transcript: hand over with
    // no id, and the renderer starts a fresh agent (and says so).
    update(run, { status: 'done', claudeSessionId: undefined, error: undefined })
    return
  }
  const tail = summarizeCreateFailure(run.output)
  update(run, {
    status: 'failed',
    error: tail
      ? `Teleport ended (exit ${code}) before the conversation came down:\n${tail}`
      : `Teleport ended (exit ${code}) before the conversation came down`,
  })
}

async function tick(run: Run): Promise<void> {
  if (run.polling || !live(run) || run.exited) return
  if (run.state.status !== 'running' && run.state.status !== 'needs-input') return
  run.polling = true
  try {
    const found = await transcriptOf(run).catch(() => null)
    if (!live(run) || run.exited) return
    if (found && (found.marked || run.readyAt !== null)) {
      if (run.handedOver || run.state.waiting === 'timeout') {
        // The user may be mid-turn in the terminal: never close it under
        // them. Record the id; "Open in Agent view" finishes the run.
        if (run.state.claudeSessionId !== found.id) update(run, { claudeSessionId: found.id })
        return
      }
      // Wait for it to stop growing so we do not close the REPL mid-write.
      if (run.lastSize === found.size) {
        update(run, { claudeSessionId: found.id })
        finish(run)
        return
      }
      run.lastSize = found.size
      return
    }
    if (run.state.status === 'needs-input') return
    const now = Date.now()
    if (run.readyAt !== null && now - run.readyAt > TELEPORT_TRANSCRIPT_WAIT_MS) {
      // The REPL has the conversation, but Claude Code writes it to disk only
      // once it changes. Show the terminal; the user can carry on there.
      run.handedOver = true
      update(run, { status: 'needs-input', waiting: 'first-message' })
    } else if (run.readyAt === null && now - run.progressAt > TELEPORT_STALL_MS) {
      update(run, { status: 'needs-input', waiting: 'timeout' })
    }
  } finally {
    run.polling = false
  }
}

function onData(run: Run, data: string): void {
  run.output = (run.output + data).slice(-OUTPUT_CAP)
  if (run.state.status !== 'running' && run.state.status !== 'needs-input') return
  const steps = Array.from(new Set([...run.state.steps, ...progressStepsIn(run.output)]))
  const now = Date.now()
  if (steps.length !== run.state.steps.length) run.progressAt = now
  if (run.readyAt === null && replReadyIn(run.output)) {
    run.readyAt = now
    run.progressAt = now
  }
  if (awaitingInputIn(run.output)) {
    run.progressAt = now
    update(run, { steps, status: 'needs-input', waiting: 'prompt' })
    return
  }
  // A dialog answered → back to running, or to the hand-over once the REPL
  // was handed to the user. A timeout clears only once something moves.
  if (run.handedOver) return update(run, { steps, status: 'needs-input', waiting: 'first-message' })
  if (run.state.waiting === 'timeout' && run.progressAt !== now) return update(run, { steps })
  update(run, { steps, status: 'running' })
}

/**
 * Spawn `claude --teleport <id>` in the Agent tab's PTY and watch it. The
 * caller has already checked the tree is clean and written hook settings.
 */
export function startTeleport(window: BrowserWindow, opts: StartTeleportOptions): CloudTeleportState {
  const argv = teleportArgv(opts.cloudSessionId)
  forgetTeleport(opts.sessionId)
  // One cloud PTY per session Agent tab; spawnTerminal is idempotent per tab.
  terminalService.killTerminalsForTab(opts.sessionId, TELEPORT_PTY_TAB)
  // Recorded before the PTY starts so discovery only looks at files written from here on.
  const startedAt = new Date().toISOString()
  const terminalId = terminalService.spawnTerminal(
    window,
    opts.sessionId,
    opts.worktreePath,
    'command',
    opts.claudeTheme ?? 'dark',
    opts.configDir ?? undefined,
    claudeShellCommand(argv),
    opts.repoPath,
    false,
    opts.sessionId,
    TELEPORT_PTY_TAB
  )
  const run: Run = {
    state: {
      sessionId: opts.sessionId,
      ...(opts.projectId ? { projectId: opts.projectId } : {}),
      terminalId,
      status: 'running',
      steps: [],
      startedAt,
    },
    opts,
    window,
    output: '',
    readyAt: null,
    progressAt: Date.now(),
    lastSize: null,
    poll: null,
    polling: false,
    exited: false,
    userFinished: false,
    handedOver: false,
  }
  runs.set(opts.sessionId, run)
  run.unwatch = terminalService.watchTerminal(terminalId, {
    onData: (data) => {
      if (live(run)) onData(run, data)
    },
    onExit: (code) => {
      run.exited = true
      stopPolling(run)
      run.unwatch = undefined
      if (!live(run)) return
      void settle(run, code)
    },
  })
  run.poll = setInterval(() => void tick(run), TELEPORT_POLL_MS)
  return snapshot(run)
}

/**
 * The user asked to switch to the visual agent now (e.g. the transcript is
 * there but the CLI never printed a marker, or the run was handed over).
 * Closes the PTY; the run settles to `done` with the transcript written since
 * the start, or — none saved — `done` with no id (the renderer starts a fresh
 * agent and says why).
 */
export function finishTeleport(sessionId: string): CloudTeleportState | null {
  const run = runs.get(sessionId)
  if (!run) return null
  run.userFinished = true
  if (run.exited) {
    if (run.state.status === 'failed' || run.state.status === 'running' || run.state.status === 'needs-input') {
      run.state = { ...run.state, status: 'finishing' }
      void settle(run, 0)
    }
    return snapshot(run)
  }
  finish(run)
  return snapshot(run)
}

/** Test hook. */
export function _resetTeleportRuns(): void {
  for (const id of [...runs.keys()]) forgetTeleport(id)
}
