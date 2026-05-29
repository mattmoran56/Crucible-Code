import { BrowserWindow } from 'electron'
import { handle } from './handle'
import { IPC } from '../../shared/constants'
import * as terminalService from '../services/terminal.service'
import { writeClaudeHookSettings } from '../services/hook.service'
import { seedPermissions, startWatching, stopWatching, setWindow } from '../services/permission-sync.service'
import type { TerminalMode } from '../services/terminal.service'

export function registerTerminalHandlers(window: BrowserWindow) {
  setWindow(window)

  handle(
    IPC.TERMINAL_SPAWN,
    async (
      _e,
      sessionId: string,
      cwd: string,
      mode?: TerminalMode,
      claudeTheme?: string,
      claudeConfigDir?: string,
      repoPath?: string,
      resume?: boolean,
      contextId?: string,
      tabId?: string
    ) => {
      // Write Claude Code hook settings so notifications route to our server
      // and statusLine writes usage data for this session
      writeClaudeHookSettings(cwd, claudeTheme ?? 'dark', sessionId)

      // Sync shared permissions from the main repo into this worktree
      if (repoPath) {
        seedPermissions(repoPath, cwd)
        startWatching(repoPath, cwd)
      }

      return terminalService.spawnTerminal(
        window,
        sessionId,
        cwd,
        mode || 'shell',
        claudeTheme ?? 'dark',
        claudeConfigDir,
        undefined,
        repoPath,
        resume ?? false,
        contextId,
        tabId
      )
    }
  )

  handle(IPC.TERMINAL_WRITE, async (_e, terminalId: string, data: string) => {
    // Log non-trivial writes (skip 1-char keystrokes) so we can see when
    // automated injections (writeWhenReady, /review, notion startup) happen.
    if (data.length > 2) {
      console.log(`[terminal-write] ${terminalId}: ${JSON.stringify(data.slice(0, 200))}`)
    }
    terminalService.writeTerminal(terminalId, data)
  })

  handle(IPC.TERMINAL_RESIZE, async (_e, terminalId: string, cols: number, rows: number) => {
    terminalService.resizeTerminal(terminalId, cols, rows)
  })

  handle(IPC.TERMINAL_KILL, async (_e, terminalId: string) => {
    const cwd = terminalService.getTerminalCwd(terminalId)
    if (cwd) {
      stopWatching(cwd)
    }
    terminalService.killTerminal(terminalId)
  })

  handle(IPC.TERMINAL_KILL_SESSION, async (_e, sessionId: string) => {
    const cwds = terminalService.killSessionTerminals(sessionId)
    for (const cwd of cwds) {
      stopWatching(cwd)
    }
  })

  handle(IPC.TERMINAL_RECOVERY_LIST, async () => {
    return terminalService.getAndClearRecoveryList()
  })

  handle(IPC.TERMINAL_LIST_FOR_SESSION, async (_e, sessionId: string) => {
    return terminalService.listTerminalsForSession(sessionId)
  })

  handle(IPC.TERMINAL_GET_BUFFER, async (_e, terminalId: string) => {
    return terminalService.getTerminalBuffer(terminalId)
  })
}
