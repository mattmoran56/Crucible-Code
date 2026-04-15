import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '../../shared/constants'
import * as terminalService from '../services/terminal.service'
import { writeClaudeHookSettings } from '../services/hook.service'
import { seedPermissions, startWatching, stopWatching, setWindow } from '../services/permission-sync.service'
import * as configSync from '../services/config-sync.service'
import type { TerminalMode } from '../services/terminal.service'

export function registerTerminalHandlers(window: BrowserWindow) {
  setWindow(window)

  ipcMain.handle(
    IPC.TERMINAL_SPAWN,
    async (_e, sessionId: string, cwd: string, mode?: TerminalMode, claudeTheme?: string, claudeConfigDir?: string, repoPath?: string, resume?: boolean) => {
      // Write Claude Code hook settings so notifications route to our server
      // and statusLine writes usage data for this session
      writeClaudeHookSettings(cwd, claudeTheme ?? 'dark', sessionId)

      // Sync shared permissions from the main repo into this worktree
      if (repoPath) {
        seedPermissions(repoPath, cwd)
        startWatching(repoPath, cwd)

        // Sync Claude config (commands, CLAUDE.md) from canonical to this worktree
        configSync.syncConfigToWorktree(repoPath, cwd)
        configSync.startWatching(repoPath, cwd)
      }

      return terminalService.spawnTerminal(window, sessionId, cwd, mode || 'shell', claudeTheme ?? 'dark', claudeConfigDir, undefined, repoPath, resume ?? false)
    }
  )

  ipcMain.handle(IPC.TERMINAL_WRITE, async (_e, terminalId: string, data: string) => {
    terminalService.writeTerminal(terminalId, data)
  })

  ipcMain.handle(IPC.TERMINAL_RESIZE, async (_e, terminalId: string, cols: number, rows: number) => {
    terminalService.resizeTerminal(terminalId, cols, rows)
  })

  ipcMain.handle(IPC.TERMINAL_KILL, async (_e, terminalId: string) => {
    const cwd = terminalService.getTerminalCwd(terminalId)
    if (cwd) {
      stopWatching(cwd)
      configSync.stopWatching(cwd)
    }
    terminalService.killTerminal(terminalId)
  })

  ipcMain.handle(IPC.TERMINAL_KILL_SESSION, async (_e, sessionId: string) => {
    const cwds = terminalService.killSessionTerminals(sessionId)
    for (const cwd of cwds) {
      stopWatching(cwd)
      configSync.stopWatching(cwd)
    }
  })

  ipcMain.handle(IPC.TERMINAL_RECOVERY_LIST, async () => {
    return terminalService.getAndClearRecoveryList()
  })
}
