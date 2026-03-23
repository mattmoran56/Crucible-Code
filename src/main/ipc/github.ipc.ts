import { ipcMain } from 'electron'
import Store from 'electron-store'
import { IPC } from '../../shared/constants'
import type { PRReviewEvent, PRMergeMethod } from '../../shared/types'
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

  ipcMain.handle(IPC.PR_DIFF, async (_e, repoPath: string, prNumber: number) => {
    return githubService.getPRDiff(repoPath, prNumber)
  })

  ipcMain.handle(IPC.PR_FILES, async (_e, repoPath: string, prNumber: number) => {
    return githubService.getPRFiles(repoPath, prNumber)
  })

  ipcMain.handle(IPC.PR_COMMENTS, async (_e, repoPath: string, prNumber: number) => {
    return githubService.getPRComments(repoPath, prNumber)
  })

  ipcMain.handle(
    IPC.PR_COMMENT_CREATE,
    async (_e, repoPath: string, prNumber: number, body: string, path: string, line: number, startLine?: number, side?: 'LEFT' | 'RIGHT') => {
      return githubService.createPRComment(repoPath, prNumber, body, path, line, startLine, side)
    }
  )

  ipcMain.handle(
    IPC.PR_REVIEW,
    async (_e, repoPath: string, prNumber: number, event: PRReviewEvent, body?: string) => {
      return githubService.submitPRReview(repoPath, prNumber, event, body)
    }
  )

  ipcMain.handle(
    IPC.PR_MERGE,
    async (_e, repoPath: string, prNumber: number, method: PRMergeMethod) => {
      return githubService.mergePR(repoPath, prNumber, method)
    }
  )
}
