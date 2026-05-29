import { IPC } from '../../shared/constants'
import { handle } from './handle'
import * as claudeWebService from '../services/claudeWebSessions.service'

export function registerClaudeWebHandlers() {
  handle(
    IPC.CLAUDE_WEB_LIST_SESSIONS,
    async (_e, repoPath: string, prefix: string | undefined, githubLogin: string | null) => {
      return claudeWebService.listClaudeWebSessions(repoPath, prefix, githubLogin)
    }
  )
}
