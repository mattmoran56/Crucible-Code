import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '../../shared/constants'
import * as terminalService from '../services/terminal.service'

export function registerTerminalHandlers(window: BrowserWindow) {
  ipcMain.handle(IPC.TERMINAL_SPAWN, async (_e, sessionId: string, cwd: string) => {
    return terminalService.spawnTerminal(window, sessionId, cwd)
  })

  ipcMain.handle(IPC.TERMINAL_WRITE, async (_e, terminalId: string, data: string) => {
    terminalService.writeTerminal(terminalId, data)
  })

  ipcMain.handle(IPC.TERMINAL_RESIZE, async (_e, terminalId: string, cols: number, rows: number) => {
    terminalService.resizeTerminal(terminalId, cols, rows)
  })

  ipcMain.handle(IPC.TERMINAL_KILL, async (_e, terminalId: string) => {
    terminalService.killTerminal(terminalId)
  })
}
