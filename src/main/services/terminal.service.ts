import * as pty from 'node-pty'
import { BrowserWindow } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import Store from 'electron-store'
import { IPC } from '../../shared/constants'
import { handleHookEvent, findSessionById } from './notification-server'

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
}

export interface PersistedTerminal {
  terminalId: string
  sessionId: string
  mode: TerminalMode
  cwd: string
  claudeTheme: string
  claudeConfigDir?: string
  repoPath?: string
}

const terminals = new Map<string, TerminalInstance>()
let terminalCounter = 0
let shuttingDown = false

// Persist active terminal metadata to disk so we can recover after crash
const terminalStore = new Store<{
  activeTerminals: Record<string, PersistedTerminal>
}>({
  name: 'terminal-state',
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
    // Review mode always starts fresh (no --resume)
    if (instance.mode === 'review') {
      args = ['-l', '-c', 'claude']
    } else {
      args = ['-l', '-c', isResume ? 'claude --resume' : 'claude']
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

  const ptyProcess = pty.spawn(command, args, {
    name: 'xterm-256color',
    cols: 120,
    rows: 30,
    cwd: instance.cwd,
    env,
  })

  ptyProcess.onData((data) => {
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
      const session = findSessionById(current.sessionId)
      if (session) {
        handleHookEvent(session.sessionId, session.sessionName, 'stop')
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
  resume = false
): string {
  const terminalId = `term-${++terminalCounter}`

  const instanceBase = { sessionId, mode, cwd, window, claudeTheme, claudeConfigDir, commandString, repoPath }
  const ptyProcess = spawnPty(terminalId, instanceBase, resume)

  const instance = { ...instanceBase, pty: ptyProcess, stopped: false }
  terminals.set(terminalId, instance)
  persistTerminal(terminalId, instance)
  return terminalId
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
