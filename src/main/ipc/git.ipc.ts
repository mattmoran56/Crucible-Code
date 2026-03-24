import { ipcMain, shell } from 'electron'
import { IPC } from '../../shared/constants'
import * as gitService from '../services/git.service'

export function registerGitHandlers() {
  ipcMain.handle(IPC.GIT_STATUS, async (_e, repoPath: string) => {
    return gitService.getStatus(repoPath)
  })

  ipcMain.handle(IPC.GIT_LOG, async (_e, repoPath: string, maxCount?: number) => {
    return gitService.getLog(repoPath, maxCount)
  })

  ipcMain.handle(IPC.GIT_DIFF, async (_e, repoPath: string, commitHash: string) => {
    return gitService.getDiff(repoPath, commitHash)
  })

  ipcMain.handle(
    IPC.GIT_FILE_DIFF,
    async (_e, repoPath: string, commitHash: string, filePath: string) => {
      return gitService.getFileDiff(repoPath, commitHash, filePath)
    }
  )

  ipcMain.handle(IPC.GIT_WORKING_FILES, async (_e, repoPath: string) => {
    return gitService.getWorkingChangedFiles(repoPath)
  })

  ipcMain.handle(IPC.GIT_WORKING_FILE_DIFF, async (_e, repoPath: string, filePath: string) => {
    return gitService.getWorkingFileDiff(repoPath, filePath)
  })

  ipcMain.handle(IPC.GIT_COMMIT_STATUSES, async (_e, repoPath: string) => {
    return gitService.getCommitStatuses(repoPath)
  })

  ipcMain.handle(IPC.GIT_PUSH, async (_e, repoPath: string) => {
    return gitService.pushBranch(repoPath)
  })

  ipcMain.handle(IPC.GIT_OPEN_PR, async (_e, repoPath: string) => {
    const remoteUrl = await gitService.getRemoteUrl(repoPath)
    if (!remoteUrl) throw new Error('No remote origin found')
    const githubBase = gitService.remoteUrlToGitHub(remoteUrl)
    if (!githubBase) throw new Error('Remote is not a GitHub repository')
    const status = await gitService.getStatus(repoPath)
    const branch = status.current
    await shell.openExternal(`${githubBase}/compare/${encodeURIComponent(branch)}?expand=1`)
  })

  ipcMain.handle(IPC.GIT_LIST_BRANCHES, async (_e, repoPath: string) => {
    return gitService.listBranches(repoPath)
  })

  ipcMain.handle(IPC.GIT_MERGE_CHECK, async (_e, repoPath: string, branch: string) => {
    return gitService.checkMerge(repoPath, branch)
  })

  ipcMain.handle(IPC.GIT_MERGE, async (_e, repoPath: string, branch: string) => {
    return gitService.mergeBranch(repoPath, branch)
  })

  ipcMain.handle(IPC.GIT_CHECKOUT, async (_e, repoPath: string, branch: string) => {
    return gitService.checkoutBranch(repoPath, branch)
  })

  ipcMain.handle(IPC.GIT_RESTORE_WORKTREE, async (_e, worktreePath: string, branch: string) => {
    return gitService.restoreWorktreeBranch(worktreePath, branch)
  })
}
