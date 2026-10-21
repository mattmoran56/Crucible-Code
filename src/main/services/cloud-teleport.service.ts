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
 * branch), but there it fails hard on anything it would otherwise ask about,
 * reports failures only to its debug log, and keeps the pulled conversation in
 * memory until the first new turn — so there is no local transcript to show
 * as history until the user has already sent something. The interactive REPL
 * writes the teleported conversation to
 * `<config>/projects/<encoded cwd>/<new uuid>.jsonl` as soon as it loads it.
 *
 * Completion: we poll for that transcript (findTeleportTranscript: newest
 * `.jsonl` since the start that carries a teleport marker). Once it is there
 * and has stopped growing, the REPL is closed (Ctrl-C twice, then a kill) and
 * the run is `done` with the local Claude session id; the renderer resumes it
 * as a visual agent (`--resume <id>`), whose history is rebuilt from that
 * transcript.
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
/** After the CLI says the session resumed, how long to wait for its transcript before asking the user. */
export const TELEPORT_TRANSCRIPT_WAIT_MS = 20_000
/** How long the REPL gets to exit after Ctrl-C before it is killed. */
export const TELEPORT_EXIT_WAIT_MS = 4_000

const OUTPUT_CAP = 64 * 1024

/* --- reading the PTY (pure) ------------------------------------------------ */

/** Progress lines `claude --teleport` prints (verified strings, 2.1.306). */
const STEPS: Array<{ re: RegExp; label: string }> = [
  { re: /Validating session/i, label: 'Validating session' },
  { re: /Fetching session logs/i, label: 'Fetching session logs' },
  { re: /Getting branch info/i, label: 'Getting branch info' },
  { re: /Checking out branch/i, label: 'Checking out branch' },
  { re: /Session resumed/i, label: 'Session resumed' },
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

/** The steps seen so far, in CLI order, each once. */
export function progressStepsIn(text: string): string[] {
  const plain = stripAnsi(text)
  return STEPS.filter((s) => s.re.test(plain)).map((s) => s.label)
}

/** The CLI printed that the teleported session is loaded. */
export const sessionResumedIn = (text: string): boolean => /Session resumed/i.test(stripAnsi(text))

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
 * compared with the newest progress line.
 */
export function awaitingInputIn(text: string): boolean {
  const plain = stripAnsi(text)
  const prompt = lastIndexOf(plain, PROMPTS)
  if (prompt < 0) return false
  return prompt > lastIndexOf(plain, STEPS.map((s) => s.re))
}

/* --- runs ------------------------------------------------------------------ */

export interface StartTeleportOptions {
  sessionId: string
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
  resumedAt: number | null
  lastSize: number | null
  poll: ReturnType<typeof setInterval> | null
  unwatch?: () => void
  polling: boolean
  exited: boolean
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
  const changed =
    next.status !== run.state.status ||
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

/** The conversation is local: close the PTY; `done` follows on its exit. */
function finish(run: Run): void {
  if (run.state.status === 'finishing' || run.state.status === 'done') return
  stopPolling(run)
  update(run, { status: 'finishing' })
  closePty(run)
}

async function settle(run: Run, code: number): Promise<void> {
  const found = await transcriptOf(run).catch(() => null)
  if (!live(run)) return
  const sure = !!found && (found.marked || run.resumedAt !== null || run.state.status === 'finishing')
  if (found && sure) {
    update(run, { status: 'done', claudeSessionId: found.id, error: undefined })
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
    if (found && (found.marked || run.resumedAt !== null)) {
      // Wait for it to stop growing so we do not close the REPL mid-write.
      if (run.lastSize === found.size) {
        update(run, { claudeSessionId: found.id })
        finish(run)
        return
      }
      run.lastSize = found.size
      return
    }
    if (run.resumedAt !== null && Date.now() - run.resumedAt > TELEPORT_TRANSCRIPT_WAIT_MS && run.state.status !== 'needs-input') {
      // The CLI says it is loaded but nothing is on disk yet: let the user see
      // the terminal. Polling continues; finishTeleport can be asked for.
      update(run, { status: 'needs-input' })
    }
  } finally {
    run.polling = false
  }
}

function onData(run: Run, data: string): void {
  run.output = (run.output + data).slice(-OUTPUT_CAP)
  if (run.state.status !== 'running' && run.state.status !== 'needs-input') return
  const steps = Array.from(new Set([...run.state.steps, ...progressStepsIn(run.output)]))
  if (run.resumedAt === null && sessionResumedIn(run.output)) run.resumedAt = Date.now()
  const waiting = awaitingInputIn(run.output)
  const stalled = run.resumedAt !== null && Date.now() - run.resumedAt > TELEPORT_TRANSCRIPT_WAIT_MS
  update(run, { steps, status: waiting || (stalled && run.state.status === 'needs-input') ? 'needs-input' : 'running' })
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
    state: { sessionId: opts.sessionId, terminalId, status: 'running', steps: [], startedAt },
    opts,
    window,
    output: '',
    resumedAt: null,
    lastSize: null,
    poll: null,
    polling: false,
    exited: false,
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
 * there but the CLI never printed a marker). Closes the PTY; the run settles
 * to `done` if a transcript written since the start exists.
 */
export function finishTeleport(sessionId: string): CloudTeleportState | null {
  const run = runs.get(sessionId)
  if (!run) return null
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
