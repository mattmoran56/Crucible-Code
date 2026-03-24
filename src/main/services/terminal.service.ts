import * as pty from 'node-pty'
import { BrowserWindow } from 'electron'
import { IPC } from '../../shared/constants'

export type TerminalMode = 'shell' | 'claude' | 'review'

interface TerminalInstance {
  pty: pty.IPty
  sessionId: string
  mode: TerminalMode
  cwd: string
  window: BrowserWindow
  stopped: boolean
  isDark: boolean
}

const terminals = new Map<string, TerminalInstance>()
let terminalCounter = 0

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
  } else {
    command = shell
    args = []
  }

  const ptyProcess = pty.spawn(command, args, {
    name: 'xterm-256color',
    cols: 120,
    rows: 30,
    cwd: instance.cwd,
    env: { ...process.env } as Record<string, string>,
  })

  ptyProcess.onData((data) => {
    instance.window.webContents.send(IPC.TERMINAL_DATA, terminalId, data)
  })

  ptyProcess.onExit(({ exitCode }) => {
    const current = terminals.get(terminalId)
    if (!current || current.stopped) {
      // Terminal was intentionally killed, don't restart
      instance.window.webContents.send(IPC.TERMINAL_EXIT, terminalId, exitCode)
      terminals.delete(terminalId)
      return
    }

    if (current.mode === 'claude') {
      // Auto-restart Claude Code after a brief pause
      instance.window.webContents.send(
        IPC.TERMINAL_DATA,
        terminalId,
        '\r\n\x1b[90m[Claude Code exited — restarting...]\x1b[0m\r\n\r\n'
      )

      setTimeout(() => {
        const check = terminals.get(terminalId)
        if (!check || check.stopped) return

        const newPty = spawnPty(terminalId, instance, true)
        check.pty = newPty
      }, 1000)
    } else {
      instance.window.webContents.send(IPC.TERMINAL_EXIT, terminalId, exitCode)
      terminals.delete(terminalId)
    }
  })

  return ptyProcess
}

export function spawnTerminal(
  window: BrowserWindow,
  sessionId: string,
  cwd: string,
  mode: TerminalMode = 'shell',
  isDark = true
): string {
  const terminalId = `term-${++terminalCounter}`

  const instanceBase = { sessionId, mode, cwd, window, isDark }
  const ptyProcess = spawnPty(terminalId, instanceBase, false)

  terminals.set(terminalId, { ...instanceBase, pty: ptyProcess, stopped: false })
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
  }
}

export function killSessionTerminals(sessionId: string): void {
  for (const [id, instance] of terminals) {
    if (instance.sessionId === sessionId) {
      instance.stopped = true
      instance.pty.kill()
      terminals.delete(id)
    }
  }
}
