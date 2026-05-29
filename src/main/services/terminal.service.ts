import * as pty from 'node-pty'
import { BrowserWindow } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import Store from 'electron-store'
import { IPC } from '../../shared/constants'
import { handleHookEvent, findContextById } from './notification-server'
import { getStorePath } from '../store-path'

export type TerminalMode = 'shell' | 'claude' | 'review' | 'command'

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
  /** Rolling tail of recent PTY output so remote attachers see what just happened. */
  buffer: string
}

const BUFFER_CAP = 64 * 1024

function appendToBuffer(instance: TerminalInstance, chunk: string): void {
  instance.buffer = (instance.buffer + chunk).slice(-BUFFER_CAP)
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
    // Use the shell to run claude so PATH is resolved
    command = shell
    // First launch: plain `claude`. After exit/restart: `claude --resume`
    // Review mode always starts fresh (no --resume).
    //
    // When `commandString` is set on a fresh `claude` launch, we pipe it into
    // claude via heredoc so the prompt arrives as stdin before claude binds
    // raw-mode TTY. Claude processes the prompt, generates a response, and
    // exits — the onExit handler then auto-restarts with `claude --resume`,
    // dropping the user back into an interactive session that already has
    // the conversation history. This is the same trick the custom-button
    // background-claude flow uses, made interactive-friendly by piggy-backing
    // on the auto-restart logic.
    if (instance.mode === 'review') {
      args = ['-l', '-c', 'claude']
    } else if (isResume) {
      args = ['-l', '-c', 'claude --resume']
    } else if (instance.commandString) {
      args = [
        '-l',
        '-c',
        `claude <<'CRUCIBLE_PROMPT_EOF'\n${instance.commandString}\nCRUCIBLE_PROMPT_EOF`,
      ]
    } else {
      args = ['-l', '-c', 'claude']
    }
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

  ptyProcess.onData((data) => {
    const current = terminals.get(terminalId)
    if (current) appendToBuffer(current, data)
    safeSend(instance.window, IPC.TERMINAL_DATA, terminalId, data)
  })

  ptyProcess.onExit(({ exitCode }) => {
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
  tabId?: string
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
  }
  const ptyProcess = spawnPty(terminalId, instanceBase, resume)

  const instance: TerminalInstance = { ...instanceBase, pty: ptyProcess, stopped: false, buffer: '' }
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
  return terminals.get(terminalId)?.buffer ?? ''
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
