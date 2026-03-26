import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '../../shared/constants'
import * as terminalService from '../services/terminal.service'
import { writeClaudeHookSettings } from '../services/hook.service'
import type { TerminalMode } from '../services/terminal.service'

export function registerTerminalHandlers(window: BrowserWindow) {
  ipcMain.handle(
    IPC.TERMINAL_SPAWN,
    async (_e, sessionId: string, cwd: string, mode?: TerminalMode, claudeTheme?: string) => {
      // Write Claude Code hook settings so notifications route to our server
      // and statusLine writes usage data for this session
      writeClaudeHookSettings(cwd, claudeTheme ?? 'dark', sessionId)
      return terminalService.spawnTerminal(window, sessionId, cwd, mode || 'shell', claudeTheme ?? 'dark')
    }
  )

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
