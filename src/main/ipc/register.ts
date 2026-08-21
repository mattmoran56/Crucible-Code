import { BrowserWindow } from 'electron'
import { handle } from './handle'
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
import { registerButtonHandlers } from './button.ipc'
import { registerStartupPromptHandlers } from './startup-prompt.ipc'
import { registerReviewLoopHandlers } from './review-loop.ipc'
import { registerClaudeWebHandlers } from './claudeWeb.ipc'
import { registerSchedulerHandlers } from './scheduler.ipc'
import { registerNotionHandlers } from './notion.ipc'
import { registerFoundryHandlers } from './foundry.ipc'
import { registerLocalPRHandlers } from './local-pr.ipc'
import { registerRemoteHandlers } from './remote.ipc'
import { registerOverseerHandlers } from './overseer.ipc'
import {
  registerContextMapping,
  removeContextMapping,
} from '../services/notification-server'
import type { ContextKind } from '../../shared/types'

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
  registerButtonHandlers(window)
  registerStartupPromptHandlers()
  registerReviewLoopHandlers(window)
  registerClaudeWebHandlers()
  registerSchedulerHandlers(window)
  registerNotionHandlers(window)
  registerFoundryHandlers(window)
  registerLocalPRHandlers(window)
  registerRemoteHandlers(window)
  registerOverseerHandlers(window)

  // Context mapping management for notification routing.
  // The renderer registers sessions, the Code editor (per-project) and individual
  // PRs as 'contexts' that hook events can be attributed to.
  handle(
    'notification:register-session',
    async (
      _e,
      contextId: string,
      name: string,
      projectId: string,
      worktreePath: string,
      kind: ContextKind = 'session'
    ) => {
      registerContextMapping({ contextId, name, projectId, worktreePath, kind })
    }
  )

  handle('notification:unregister-session', async (_e, contextId: string) => {
    removeContextMapping(contextId)
  })
}
