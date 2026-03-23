import { BrowserWindow } from 'electron'
import { registerGitHandlers } from './git.ipc'
import { registerWorktreeHandlers } from './worktree.ipc'
import { registerTerminalHandlers } from './terminal.ipc'
import { registerNotificationHandlers } from './notification.ipc'
import { registerProjectHandlers } from './project.ipc'

export function registerAllHandlers(window: BrowserWindow) {
  registerGitHandlers()
  registerWorktreeHandlers()
  registerTerminalHandlers(window)
  registerNotificationHandlers()
  registerProjectHandlers(window)
}
