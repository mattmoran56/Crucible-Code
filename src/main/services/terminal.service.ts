import * as pty from 'node-pty'
import { BrowserWindow } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import Store from 'electron-store'
import { IPC } from '../../shared/constants'
import { detectUsageLimit, type UsageLimitKind } from '../../shared/patterns'
import type { UsageLimitEvent } from '../../shared/types'
import { handleHookEvent, findContextById } from './notification-server'
import { getSessionUsage } from './usage.service'
import { getStorePath } from '../store-path'

export type TerminalMode = 'shell' | 'claude' | 'review' | 'command'

/**
 * Permission args for every Claude session/agent we spawn.
 *
 * We deliberately pass NO `--permission-mode`, so the CLI falls back to the
 * user's configured default — which is `auto`. Auto-accepts edits and safe
 * actions so work flows hands-off while still prompting for anything riskier.
 *
 * Why empty and not `['--permission-mode', 'auto']`? Older Claude Code treated
 * "auto" as an alias for `acceptEdits`; the CLI now exposes them as DISTINCT
 * modes. We used to pass `acceptEdits` explicitly, which forced sessions OUT of
 * `auto` and into the narrower accept-edits mode — the bug this fixes. Omitting
 * the flag lets each session inherit the user's `auto` default instead.
 *
 * We NEVER use bypass / `--dangerously-skip-permissions`. This array is the
 * single source of truth for session permission args, so it must never contain
 * `acceptEdits`, `bypassPermissions`, or `--dangerously-skip-permissions`.
 */
export const AUTO_PERMISSION_MODE_ARGS: string[] = []

interface TerminalInstance {
  pty: pty.IPty
  sessionId: string
  mode: TerminalMode
  cwd: string
  window: BrowserWindow
  stopped: boolean
  claudeTheme: string
  claudeConfigDir?: string
  commandString?: string
  repoPath?: string
  /** Identifier of the workspace context (session id, code-editor synthetic id, or PR synthetic id) */
  contextId: string
  /** Workspace tab id (e.g. 'agent', 'agent:1', 'review'). Used for per-agent hook routing. */
  tabId: string
  /**
   * Rolling tail of recent PTY output so remote attachers see what just
   * happened. Stored as chunks + a running byte counter to keep appends O(1)
   * amortized — concatenating into a single 64KB string on every PTY chunk
   * was a measurable CPU hotspot during Claude streaming.
   */
  bufferChunks: string[]
  bufferSize: number
  /** Extra args appended to `claude` (e.g. `--dangerously-skip-permissions`). Persisted for crash-recovery. */
  claudeArgs?: string[]
  /**
   * Rolling tail of recent output scanned for the usage-limit banner. Kept
   * separate from bufferChunks so the (possibly multi-chunk) banner is matched
   * across PTY chunk boundaries without re-scanning the full 64KB buffer.
   */
  limitScanTail?: string
  /** Epoch ms of the last USAGE_LIMIT_REACHED we emitted for this terminal. */
  lastLimitEmitAt?: number
}

/**
 * Build the shell command used to launch claude for a `claude`-mode PTY.
 * Pure — exported so unit tests can verify quoting + heredoc shape.
 *
 * Returns the body for `sh -lc '<here>'`.
 */
export function buildClaudeCommand(opts: {
  isResume: boolean
  isReview: boolean
  commandString?: string
  claudeArgs?: string[]
}): string {
  const argSuffix = (opts.claudeArgs ?? [])
    .map((a) => shellQuote(a))
    .join(' ')
  const claudeWithArgs = argSuffix ? `claude ${argSuffix}` : 'claude'
  if (opts.isReview) return claudeWithArgs
  if (opts.isResume) return `${claudeWithArgs} --resume`
  if (opts.commandString) {
    return `${claudeWithArgs} <<'CRUCIBLE_PROMPT_EOF'\n${opts.commandString}\nCRUCIBLE_PROMPT_EOF`
  }
  return claudeWithArgs
}

function shellQuote(a: string): string {
  // Single-quote and escape any embedded single quotes for POSIX shells.
  if (/^[A-Za-z0-9_\-\/=:.,@+]+$/.test(a)) return a
  return `'${a.replace(/'/g, `'\\''`)}'`
}

const BUFFER_CAP = 64 * 1024
// Compact the rolling buffer when it grows past this size; trades a rare
// O(n) join for O(1) appends in between.
const BUFFER_COMPACT_AT = BUFFER_CAP * 2

function appendToBuffer(instance: TerminalInstance, chunk: string): void {
  instance.bufferChunks.push(chunk)
  instance.bufferSize += chunk.length
  if (instance.bufferSize > BUFFER_COMPACT_AT) {
    const compacted = instance.bufferChunks.join('').slice(-BUFFER_CAP)
    instance.bufferChunks = [compacted]
    instance.bufferSize = compacted.length
  }
}

// Cap on the per-terminal scan tail. Big enough to span a banner split across
// several PTY chunks, small enough that the regex scan stays cheap per chunk.
const LIMIT_SCAN_TAIL_MAX = 8 * 1024
// Once we've surfaced a limit hit, ignore further matches for this long. The
// blocked prompt box keeps redrawing for the whole reset window; without this
// every redraw would re-fire. The renderer also de-dupes per session, so this
// only needs to cover the dismiss-without-queue case.
const LIMIT_EMIT_COOLDOWN_MS = 10 * 60 * 1000

/** Resolve a reset timestamp (unix seconds) for a detected limit hit. */
function resolveResetsAt(sessionId: string, kind: UsageLimitKind): number {
  const usage = getSessionUsage(sessionId)
  const nowSec = Math.floor(Date.now() / 1000)
  if (kind === 'weekly') {
    return usage?.rateLimits?.sevenDay?.resetsAt || nowSec + 7 * 24 * 3600
  }
  return usage?.rateLimits?.fiveHour?.resetsAt || nowSec + 5 * 3600
}

/**
 * Scan a freshly arrived PTY chunk for the genuine usage-limit banner and, on
 * the first sighting, emit USAGE_LIMIT_REACHED so the renderer can offer to
 * queue a follow-up. Only claude/review terminals are scanned.
 */
function detectAndEmitLimit(instance: TerminalInstance, chunk: string): void {
  if (instance.mode !== 'claude' && instance.mode !== 'review') return

  instance.limitScanTail = (instance.limitScanTail ?? '') + chunk
  if (instance.limitScanTail.length > LIMIT_SCAN_TAIL_MAX) {
    instance.limitScanTail = instance.limitScanTail.slice(-LIMIT_SCAN_TAIL_MAX)
  }

  const hit = detectUsageLimit(instance.limitScanTail)
  if (!hit) return

  const now = Date.now()
  if (instance.lastLimitEmitAt && now - instance.lastLimitEmitAt < LIMIT_EMIT_COOLDOWN_MS) return
  instance.lastLimitEmitAt = now
  // Drop the tail so the same on-screen banner doesn't immediately re-match.
  instance.limitScanTail = ''

  const resetsAt = hit.resetsAt ?? resolveResetsAt(instance.sessionId, hit.kind)
  const event: UsageLimitEvent = { sessionId: instance.sessionId, resetsAt }
  safeSend(instance.window, IPC.USAGE_LIMIT_REACHED, event)
}

export interface PersistedTerminal {
  terminalId: string
  sessionId: string
  mode: TerminalMode
  cwd: string
  claudeTheme: string
  claudeConfigDir?: string
  repoPath?: string
  contextId: string
  tabId: string
  claudeArgs?: string[]
}

const terminals = new Map<string, TerminalInstance>()
let terminalCounter = 0
let shuttingDown = false

// Persist active terminal metadata to disk so we can recover after crash
const terminalStore = new Store<{
  activeTerminals: Record<string, PersistedTerminal>
}>({
  name: 'terminal-state',
  cwd: getStorePath(),
  defaults: { activeTerminals: {} },
})

function persistTerminal(terminalId: string, instance: TerminalInstance): void {
  terminalStore.set(`activeTerminals.${terminalId}`, {
    terminalId,
    sessionId: instance.sessionId,
    mode: instance.mode,
    cwd: instance.cwd,
    claudeTheme: instance.claudeTheme,
    claudeConfigDir: instance.claudeConfigDir,
    repoPath: instance.repoPath,
    contextId: instance.contextId,
    tabId: instance.tabId,
    claudeArgs: instance.claudeArgs,
  })
}

function unpersistTerminal(terminalId: string): void {
  terminalStore.delete(`activeTerminals.${terminalId}` as any)
}

/**
 * Called on app startup. Returns the list of terminals that were active before
 * the last shutdown/crash, then clears the persisted state (the PTY processes
 * are dead, so the list is only useful for recovery spawning).
 */
export function getAndClearRecoveryList(): PersistedTerminal[] {
  const active = terminalStore.get('activeTerminals', {})
  const list = Object.values(active)
  terminalStore.set('activeTerminals', {})
  return list
}

/** Safely send IPC — no-op if the window is already destroyed. */
function safeSend(window: BrowserWindow, channel: string, ...args: unknown[]): void {
  if (!window.isDestroyed()) {
    window.webContents.send(channel, ...args)
  }
}

function spawnPty(
  terminalId: string,
  instance: Omit<TerminalInstance, 'pty' | 'stopped'>,
  isResume: boolean
): pty.IPty {
  const shell = process.env.SHELL || '/bin/zsh'

  let command: string
  let args: string[]

  if (instance.mode === 'claude' || instance.mode === 'review') {
    command = shell
    const shellBody = buildClaudeCommand({
      isResume,
      isReview: instance.mode === 'review',
      commandString: instance.commandString,
      claudeArgs: instance.claudeArgs,
    })
    args = ['-l', '-c', shellBody]
  } else if (instance.mode === 'command' && instance.commandString) {
    // Run a specific command via shell -l -c "cmd", exits when done
    command = shell
    args = ['-l', '-c', instance.commandString]
  } else {
    command = shell
    args = []
  }

  const env: Record<string, string> = { ...process.env } as Record<string, string>
  if (instance.claudeConfigDir) {
    const resolved = instance.claudeConfigDir.startsWith('~/')
      ? join(homedir(), instance.claudeConfigDir.slice(2))
      : instance.claudeConfigDir
    env.CLAUDE_CONFIG_DIR = resolved
  } else {
    // The project resolves to the "Default" Claude account, which the UI
    // labels as ~/.claude. Explicitly drop any inherited CLAUDE_CONFIG_DIR
    // so we actually land there — otherwise a dev launcher (or any parent
    // shell that exports CLAUDE_CONFIG_DIR=~/.claude-personal) would
    // silently hijack every "Default" worker.
    delete env.CLAUDE_CONFIG_DIR
  }
  // Identify the context + agent tab for hook routing. The hook curl uses
  // ${CRUCIBLE_CONTEXT_ID}/${CRUCIBLE_TAB_ID} via shell expansion to attach
  // these to the URL, so the notification server can resolve which tab fired.
  env.CRUCIBLE_CONTEXT_ID = instance.contextId
  env.CRUCIBLE_TAB_ID = instance.tabId

  const ptyProcess = pty.spawn(command, args, {
    name: 'xterm-256color',
    cols: 120,
    rows: 30,
    cwd: instance.cwd,
    env,
  })

  // Coalesce PTY data into ~16ms (one render frame) windows before crossing
  // the IPC boundary. Claude streaming can fire 100+ data callbacks per
  // second; one IPC + structured-clone per chunk used to dominate main-process
  // CPU. We still append to the rolling buffer synchronously so getTerminalBuffer
  // returns up-to-date bytes to late attachers.
  let pendingChunks: string[] = []
  let flushTimer: NodeJS.Timeout | null = null

  const flushPending = (): void => {
    flushTimer = null
    if (pendingChunks.length === 0) return
    const out = pendingChunks.length === 1 ? pendingChunks[0] : pendingChunks.join('')
    pendingChunks = []
    safeSend(instance.window, IPC.TERMINAL_DATA, terminalId, out)
  }

  ptyProcess.onData((data) => {
    const current = terminals.get(terminalId)
    if (current) {
      appendToBuffer(current, data)
      detectAndEmitLimit(current, data)
    }
    pendingChunks.push(data)
    if (!flushTimer) {
      flushTimer = setTimeout(flushPending, 16)
    }
  })

  ptyProcess.onExit(({ exitCode }) => {
    // Drain anything left in the IPC batch before the exit/restart banner so
    // the renderer never loses the trailing bytes that landed inside the
    // last coalesce window.
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    flushPending()

    // During shutdown, skip all exit handling to avoid errors
    if (shuttingDown) return

    const current = terminals.get(terminalId)
    if (!current || current.stopped) {
      // Terminal was intentionally killed, don't restart
      safeSend(instance.window, IPC.TERMINAL_EXIT, terminalId, exitCode)
      terminals.delete(terminalId)
      unpersistTerminal(terminalId)
      return
    }

    if (current.mode === 'claude') {
      // The process exited — emit a definitive 'stop' event.
      // This is the ground truth that the task finished, even if the
      // Stop hook's curl call was swallowed or timed out.
      const ctx = findContextById(current.contextId)
      if (ctx) {
        handleHookEvent(ctx.contextId, current.tabId, 'stop')
      }

      // Auto-restart Claude Code after a brief pause
      safeSend(
        instance.window,
        IPC.TERMINAL_DATA,
        terminalId,
        '\r\n\x1b[90m[Claude Code exited — restarting...]\x1b[0m\r\n\r\n'
      )

      setTimeout(() => {
        if (shuttingDown) return
        const check = terminals.get(terminalId)
        if (!check || check.stopped) return

        const newPty = spawnPty(terminalId, instance, true)
        check.pty = newPty
      }, 1000)
    } else {
      safeSend(instance.window, IPC.TERMINAL_EXIT, terminalId, exitCode)
      terminals.delete(terminalId)
      unpersistTerminal(terminalId)
    }
  })

  return ptyProcess
}

export function spawnTerminal(
  window: BrowserWindow,
  sessionId: string,
  cwd: string,
  mode: TerminalMode = 'shell',
  claudeTheme = 'dark',
  claudeConfigDir?: string,
  commandString?: string,
  repoPath?: string,
  resume = false,
  contextId?: string,
  tabId?: string,
  claudeArgs?: string[]
): string {
  const resolvedTabId = tabId ?? (mode === 'review' ? 'review' : 'agent')
  // Idempotent per (sessionId, tabId): if a live terminal already owns this
  // workspace tab, hand back its id rather than spawning a duplicate. Prevents
  // orphan PTYs piling up when a remote receiver reconnects or re-mounts.
  for (const [existingId, existing] of terminals) {
    if (
      existing.sessionId === sessionId &&
      existing.tabId === resolvedTabId &&
      !existing.stopped
    ) {
      return existingId
    }
  }
  const terminalId = `term-${++terminalCounter}`

  const instanceBase = {
    sessionId,
    mode,
    cwd,
    window,
    claudeTheme,
    claudeConfigDir,
    commandString,
    repoPath,
    contextId: contextId ?? sessionId,
    tabId: resolvedTabId,
    claudeArgs,
  }
  const ptyProcess = spawnPty(terminalId, instanceBase, resume)

  const instance: TerminalInstance = {
    ...instanceBase,
    pty: ptyProcess,
    stopped: false,
    bufferChunks: [],
    bufferSize: 0,
  }
  terminals.set(terminalId, instance)
  persistTerminal(terminalId, instance)
  return terminalId
}

function counterOf(terminalId: string): number {
  const n = Number(terminalId.replace(/^term-/, ''))
  return Number.isFinite(n) ? n : 0
}

/** List active terminals for a given session — used by the remote receiver to render its tab strip.
 *
 * Deduplicates by tabId (keeping the OLDEST live terminal, which is the one the desktop xterm
 * originally bound to). Older-but-now-orphaned duplicates are silently killed so listings
 * converge to the desktop's view of the world.
 */
export function listTerminalsForSession(sessionId: string): Array<{
  terminalId: string
  mode: TerminalMode
  tabId: string
  contextId: string
}> {
  const byTab = new Map<string, { terminalId: string; mode: TerminalMode; tabId: string; contextId: string }>()
  const losers: string[] = []
  for (const [terminalId, instance] of terminals) {
    if (instance.sessionId !== sessionId || instance.stopped) continue
    const existing = byTab.get(instance.tabId)
    if (!existing) {
      byTab.set(instance.tabId, {
        terminalId,
        mode: instance.mode,
        tabId: instance.tabId,
        contextId: instance.contextId,
      })
      continue
    }
    // Keep whichever is older (lower counter). The other is an orphan.
    if (counterOf(terminalId) < counterOf(existing.terminalId)) {
      losers.push(existing.terminalId)
      byTab.set(instance.tabId, {
        terminalId,
        mode: instance.mode,
        tabId: instance.tabId,
        contextId: instance.contextId,
      })
    } else {
      losers.push(terminalId)
    }
  }
  for (const id of losers) {
    const inst = terminals.get(id)
    if (inst) {
      inst.stopped = true
      try { inst.pty.kill() } catch { /* already dead */ }
      terminals.delete(id)
    }
  }
  return Array.from(byTab.values())
}

/** Return the recent output tail for a terminal so a late-attacher can render context. */
export function getTerminalBuffer(terminalId: string): string {
  const instance = terminals.get(terminalId)
  if (!instance || instance.bufferChunks.length === 0) return ''
  if (instance.bufferChunks.length === 1) return instance.bufferChunks[0]
  // Compact on read so subsequent reads (and the next appendToBuffer) are cheap.
  const compacted = instance.bufferChunks.join('').slice(-BUFFER_CAP)
  instance.bufferChunks = [compacted]
  instance.bufferSize = compacted.length
  return compacted
}

export function writeTerminal(terminalId: string, data: string): void {
  const instance = terminals.get(terminalId)
  if (instance) {
    instance.pty.write(data)
  }
}

export function resizeTerminal(terminalId: string, cols: number, rows: number): void {
  const instance = terminals.get(terminalId)
  if (instance) {
    instance.pty.resize(cols, rows)
  }
}

export function killTerminal(terminalId: string): void {
  const instance = terminals.get(terminalId)
  if (instance) {
    instance.stopped = true
    instance.pty.kill()
    terminals.delete(terminalId)
    unpersistTerminal(terminalId)
  }
}

export function getTerminalCwd(terminalId: string): string | undefined {
  return terminals.get(terminalId)?.cwd
}

/**
 * Kill every review-loop PTY for a session (tabId prefixed `review-loop:`).
 *
 * The review loop can open three PTYs per round across many rounds; without an
 * explicit sweep they accumulate toward the macOS 511 pseudo-terminal cap. We
 * call this when a loop finalizes and when a new loop starts for the session,
 * so stale phase terminals never pile up. The renderer keeps each xterm's
 * scrollback after the PTY dies, so frozen/completed columns stay readable.
 * Returns the number of terminals killed.
 */
export function killReviewLoopTerminals(sessionId: string): number {
  let killed = 0
  for (const [id, instance] of terminals) {
    if (instance.sessionId === sessionId && instance.tabId.startsWith('review-loop:')) {
      instance.stopped = true
      try { instance.pty.kill() } catch { /* already dead */ }
      terminals.delete(id)
      unpersistTerminal(id)
      killed += 1
    }
  }
  return killed
}

/** Kill all terminals belonging to a session. Returns cwds for cleanup of watchers. */
export function killSessionTerminals(sessionId: string): string[] {
  const cwds: string[] = []
  for (const [id, instance] of terminals) {
    if (instance.sessionId === sessionId) {
      cwds.push(instance.cwd)
      instance.stopped = true
      instance.pty.kill()
      terminals.delete(id)
      unpersistTerminal(id)
    }
  }
  return cwds
}

/** Kill every terminal (used on app quit). */
export function killAllTerminals(): void {
  shuttingDown = true
  for (const [id, instance] of terminals) {
    instance.stopped = true
    instance.pty.kill()
    unpersistTerminal(id)
  }
  terminals.clear()
}
