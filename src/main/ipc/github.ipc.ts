import { ipcMain } from 'electron'
import Store from 'electron-store'
import { IPC } from '../../shared/constants'
import * as githubService from '../services/github.service'

const store = new Store<{
  seenPRs: Record<string, number[]>
}>({
  name: 'github',
  defaults: {
    seenPRs: {},
  },
})

export function registerGithubHandlers() {
  ipcMain.handle(IPC.PR_LIST, async (_e, repoPath: string) => {
    return githubService.listOpenPRs(repoPath)
  })

  ipcMain.handle(IPC.PR_SEEN_GET, async (_e, projectId: string) => {
    return store.get(`seenPRs.${projectId}`, [])
  })

  ipcMain.handle(IPC.PR_SEEN_SET, async (_e, projectId: string, prNumber: number) => {
    const seen = store.get(`seenPRs.${projectId}`, []) as number[]
    if (!seen.includes(prNumber)) {
      seen.push(prNumber)
      store.set(`seenPRs.${projectId}`, seen)
    }
  })
}
