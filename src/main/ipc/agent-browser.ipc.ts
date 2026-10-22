import { shell } from 'electron'
import { handle } from './handle'
import { IPC } from '../../shared/constants'
import { isWebUrl } from '../../shared/agent-browser'

export function registerAgentBrowserHandlers() {
  handle(IPC.AGENT_BROWSER_OPEN_EXTERNAL, async (_e, url: string): Promise<void> => {
    if (!isWebUrl(url)) throw new Error('Refusing to open a non-web URL')
    await shell.openExternal(url)
  })
}
