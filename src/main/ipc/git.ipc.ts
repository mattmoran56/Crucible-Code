import { ipcMain } from 'electron'
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

  ipcMain.handle(IPC.GIT_CHECKOUT, async (_e, repoPath: string, branch: string) => {
    return gitService.checkoutBranch(repoPath, branch)
  })

  ipcMain.handle(IPC.GIT_RESTORE_WORKTREE, async (_e, worktreePath: string, branch: string) => {
    return gitService.restoreWorktreeBranch(worktreePath, branch)
  })
}
