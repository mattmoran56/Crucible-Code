import Store from 'electron-store'
import { handle } from './handle'
import { IPC } from '../../shared/constants'
import type { StartupPrompt } from '../../shared/types'
import { getStorePath } from '../store-path'

const store = new Store<{
  promptsByProject: Record<string, StartupPrompt[]>
}>({
  name: 'startup-prompts',
  cwd: getStorePath(),
  defaults: { promptsByProject: {} },
})

export function registerStartupPromptHandlers() {
  handle(IPC.STARTUP_PROMPT_LIST, async (_e, projectId: string): Promise<StartupPrompt[]> => {
    const all = store.get('promptsByProject', {})
    return all[projectId] ?? []
  })

  handle(
    IPC.STARTUP_PROMPT_SAVE,
    async (_e, projectId: string, prompts: StartupPrompt[]): Promise<void> => {
      const all = store.get('promptsByProject', {})
      all[projectId] = prompts
      store.set('promptsByProject', all)
    }
  )
}
