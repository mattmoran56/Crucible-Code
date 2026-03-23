import * as pty from 'node-pty'
import { BrowserWindow } from 'electron'
import { IPC } from '../../shared/constants'

interface TerminalInstance {
  pty: pty.IPty
  sessionId: string
}

const terminals = new Map<string, TerminalInstance>()
let terminalCounter = 0

export function spawnTerminal(
  window: BrowserWindow,
  sessionId: string,
  cwd: string
): string {
  const terminalId = `term-${++terminalCounter}`
  const shell = process.env.SHELL || '/bin/zsh'

  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: 120,
    rows: 30,
    cwd,
    env: { ...process.env } as Record<string, string>,
  })

  ptyProcess.onData((data) => {
    window.webContents.send(IPC.TERMINAL_DATA, terminalId, data)
  })

  ptyProcess.onExit(({ exitCode }) => {
    window.webContents.send(IPC.TERMINAL_EXIT, terminalId, exitCode)
    terminals.delete(terminalId)
  })

  terminals.set(terminalId, { pty: ptyProcess, sessionId })
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
    instance.pty.kill()
    terminals.delete(terminalId)
  }
}

export function killSessionTerminals(sessionId: string): void {
  for (const [id, instance] of terminals) {
    if (instance.sessionId === sessionId) {
      instance.pty.kill()
      terminals.delete(id)
    }
  }
}
