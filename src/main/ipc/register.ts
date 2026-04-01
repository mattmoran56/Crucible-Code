import { BrowserWindow, ipcMain } from 'electron'
import { IPC } from '../../shared/constants'
import { registerGitHandlers } from './git.ipc'
import { registerWorktreeHandlers } from './worktree.ipc'
import { registerTerminalHandlers } from './terminal.ipc'
import { registerNotificationHandlers } from './notification.ipc'
import { registerProjectHandlers } from './project.ipc'
import { registerGithubHandlers } from './github.ipc'
import { registerUpdateHandlers } from './update.ipc'
import { registerNotesHandlers } from './notes.ipc'
import { registerUsageHandlers } from './usage.ipc'
import { registerFileHandlers } from './file.ipc'
import { registerPermissionsHandlers } from './permissions.ipc'
import {
  registerSessionMapping,
  removeSessionMapping,
} from '../services/notification-server'

export function registerAllHandlers(window: BrowserWindow) {
  registerGitHandlers()
  registerWorktreeHandlers()
  registerTerminalHandlers(window)
  registerNotificationHandlers()
  registerProjectHandlers(window)
  registerGithubHandlers()
  registerUpdateHandlers(window)
  registerNotesHandlers()
  registerUsageHandlers(window)
  registerFileHandlers(window)
  registerPermissionsHandlers()

  // Session mapping management for notification routing
  ipcMain.handle(
    'notification:register-session',
    async (
      _e,
      sessionId: string,
      sessionName: string,
      projectId: string,
      worktreePath: string
    ) => {
      registerSessionMapping({ sessionId, sessionName, projectId, worktreePath })
    }
  )

  ipcMain.handle('notification:unregister-session', async (_e, worktreePath: string) => {
    removeSessionMapping(worktreePath)
  })
}
