import { ipcMain, shell } from 'electron'
import { IPC } from '../../shared/constants'
import * as gitService from '../services/git.service'

export function registerGitHandlers() {
  ipcMain.handle(IPC.GIT_STATUS, async (_e, repoPath: string) => {
    const status = await gitService.getStatus(repoPath)
    // Return a plain object — raw StatusResult is not structured-cloneable
    return {
      current: status.current,
      tracking: status.tracking,
      ahead: status.ahead,
      behind: status.behind,
    }
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

  ipcMain.handle(IPC.GIT_IS_MERGED, async (_e, worktreePath: string, baseBranch: string) => {
    return gitService.isBranchMerged(worktreePath, baseBranch)
  })

  ipcMain.handle(IPC.GIT_DEFAULT_BRANCH, async (_e, repoPath: string) => {
    return gitService.getDefaultBranch(repoPath)
  })

  // Branch comparison (PR preview)
  ipcMain.handle(IPC.GIT_COMPARE_COMMITS, async (_e, repoPath: string, baseBranch: string) => {
    return gitService.getCompareCommits(repoPath, baseBranch)
  })

  ipcMain.handle(IPC.GIT_COMPARE_FILES, async (_e, repoPath: string, baseBranch: string) => {
    return gitService.getCompareFiles(repoPath, baseBranch)
  })

  ipcMain.handle(IPC.GIT_COMPARE_DIFF, async (_e, repoPath: string, baseBranch: string) => {
    return gitService.getCompareDiff(repoPath, baseBranch)
  })

  ipcMain.handle(IPC.GIT_COMPARE_FILE_DIFF, async (_e, repoPath: string, baseBranch: string, filePath: string) => {
    return gitService.getCompareFileDiff(repoPath, baseBranch, filePath)
  })

  ipcMain.handle(IPC.GIT_COMMIT_FULL_DIFF, async (_e, repoPath: string, commitHash: string) => {
    return gitService.getCommitFullDiff(repoPath, commitHash)
  })

  ipcMain.handle(IPC.GIT_WORKING_FILES_PR, async (_e, repoPath: string) => {
    return gitService.getWorkingFilesPR(repoPath)
  })

  ipcMain.handle(IPC.GIT_WORKING_DIFF, async (_e, repoPath: string) => {
    return gitService.getWorkingDiff(repoPath)
  })

  ipcMain.handle(IPC.GIT_SHOW_FILE_BASE64, async (_e, repoPath: string, ref: string, filePath: string) => {
    return gitService.showFileBase64(repoPath, ref, filePath)
  })

  ipcMain.handle(IPC.GIT_FETCH_AND_PULL, async (_e, repoPath: string, branch: string) => {
    return gitService.fetchAndPull(repoPath, branch)
  })
}
