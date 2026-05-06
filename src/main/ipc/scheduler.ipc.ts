import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '../../shared/constants'
import * as scheduler from '../services/scheduler.service'
import * as terminalService from '../services/terminal.service'
import { writeClaudeHookSettings } from '../services/hook.service'
import { seedPermissions, startWatching } from '../services/permission-sync.service'
import type { QueuedSession, QueuedMessage } from '../../shared/types'

export function registerSchedulerHandlers(window: BrowserWindow) {
  scheduler.startScheduler(window)

  // Spawn an agent terminal seeded with an initial prompt. The prompt is
  // piped into claude via a heredoc, so it lands on stdin before claude
  // even binds raw-mode TTY input — bypasses the racy `>`-detection-then-
  // write path entirely. After claude finishes the response and exits, the
  // mode='claude' onExit handler auto-restarts with `claude --resume`,
  // putting the user back into an interactive session that already has the
  // conversation history.
  ipcMain.handle(
    IPC.SCHEDULER_SPAWN_AGENT_WITH_PROMPT,
    async (
      _e,
      sessionId: string,
      cwd: string,
      prompt: string,
      claudeTheme: string,
      claudeConfigDir: string | undefined,
      repoPath: string | undefined,
      contextId: string,
      tabId: string
    ): Promise<string> => {
      // Mirror IPC.TERMINAL_SPAWN: write hook settings + seed permissions
      // for this worktree, so the queued session gets the same observability
      // (usage tracking, notifications, allow/deny lists) as a manually-
      // created one.
      writeClaudeHookSettings(cwd, claudeTheme, sessionId)
      if (repoPath) {
        seedPermissions(repoPath, cwd)
        startWatching(repoPath, cwd)
      }
      return terminalService.spawnTerminal(
        window,
        sessionId,
        cwd,
        'claude',
        claudeTheme,
        claudeConfigDir,
        prompt, // commandString — used as heredoc body for first launch
        repoPath,
        false, // not a resume — first launch with prompt
        contextId,
        tabId
      )
    }
  )

  ipcMain.handle(IPC.SCHEDULER_LIST_QUEUED_SESSIONS, async () => {
    return scheduler.listQueuedSessions()
  })

  ipcMain.handle(IPC.SCHEDULER_ADD_QUEUED_SESSION, async (_e, item: QueuedSession) => {
    return scheduler.addQueuedSession(item)
  })

  ipcMain.handle(IPC.SCHEDULER_CANCEL_QUEUED_SESSION, async (_e, id: string) => {
    return scheduler.cancelQueuedSession(id)
  })

  ipcMain.handle(
    IPC.SCHEDULER_RESCHEDULE_QUEUED_SESSION,
    async (_e, id: string, scheduledFor: number) => {
      return scheduler.rescheduleQueuedSession(id, scheduledFor)
    }
  )

  ipcMain.handle(IPC.SCHEDULER_FIRE_QUEUED_SESSION_NOW, async (_e, id: string) => {
    scheduler.fireQueuedSessionNow(id)
  })

  ipcMain.handle(IPC.SCHEDULER_LIST_QUEUED_MESSAGES, async () => {
    return scheduler.listQueuedMessages()
  })

  ipcMain.handle(IPC.SCHEDULER_ADD_QUEUED_MESSAGE, async (_e, item: QueuedMessage) => {
    return scheduler.addQueuedMessage(item)
  })

  ipcMain.handle(IPC.SCHEDULER_CANCEL_QUEUED_MESSAGE, async (_e, id: string) => {
    return scheduler.cancelQueuedMessage(id)
  })
}
