import { shell } from 'electron'
import { handle } from './handle'
import { IPC } from '../../shared/constants'
import * as gitService from '../services/git.service'

export function registerGitHandlers() {
  handle(IPC.GIT_STATUS, async (_e, repoPath: string) => {
    const status = await gitService.getStatus(repoPath)
    // Return a plain object — raw StatusResult is not structured-cloneable
    return {
      current: status.current,
      tracking: status.tracking,
      ahead: status.ahead,
      behind: status.behind,
    }
  })

  handle(IPC.GIT_LOG, async (_e, repoPath: string, maxCount?: number) => {
    return gitService.getLog(repoPath, maxCount)
  })

  handle(IPC.GIT_DIFF, async (_e, repoPath: string, commitHash: string) => {
    return gitService.getDiff(repoPath, commitHash)
  })

  handle(
    IPC.GIT_FILE_DIFF,
    async (_e, repoPath: string, commitHash: string, filePath: string) => {
      return gitService.getFileDiff(repoPath, commitHash, filePath)
    }
  )

  handle(IPC.GIT_WORKING_FILES, async (_e, repoPath: string) => {
    return gitService.getWorkingChangedFiles(repoPath)
  })

  handle(IPC.GIT_WORKING_FILE_DIFF, async (_e, repoPath: string, filePath: string) => {
    return gitService.getWorkingFileDiff(repoPath, filePath)
  })

  handle(IPC.GIT_COMMIT_STATUSES, async (_e, repoPath: string) => {
    return gitService.getCommitStatuses(repoPath)
  })

  handle(IPC.GIT_PUSH, async (_e, repoPath: string) => {
    return gitService.pushBranch(repoPath)
  })

  handle(IPC.GIT_OPEN_PR, async (_e, repoPath: string) => {
    const remoteUrl = await gitService.getRemoteUrl(repoPath)
    if (!remoteUrl) throw new Error('No remote origin found')
    const githubBase = gitService.remoteUrlToGitHub(remoteUrl)
    if (!githubBase) throw new Error('Remote is not a GitHub repository')
    const status = await gitService.getStatus(repoPath)
    const branch = status.current
    await shell.openExternal(`${githubBase}/compare/${encodeURIComponent(branch)}?expand=1`)
  })

  handle(IPC.GIT_LIST_BRANCHES, async (_e, repoPath: string) => {
    return gitService.listBranches(repoPath)
  })

  handle(IPC.GIT_MERGE_CHECK, async (_e, repoPath: string, branch: string) => {
    return gitService.checkMerge(repoPath, branch)
  })

  handle(IPC.GIT_MERGE, async (_e, repoPath: string, branch: string) => {
    return gitService.mergeBranch(repoPath, branch)
  })

  handle(IPC.GIT_CHECKOUT, async (_e, repoPath: string, branch: string, mode?: gitService.CheckoutMode) => {
    return gitService.checkoutBranch(repoPath, branch, mode)
  })

  handle(IPC.GIT_RESTORE_WORKTREE, async (_e, worktreePath: string, branch: string) => {
    return gitService.restoreWorktreeBranch(worktreePath, branch)
  })

  handle(IPC.GIT_DEFAULT_BRANCH, async (_e, repoPath: string) => {
    return gitService.getDefaultBranch(repoPath)
  })

  // Branch comparison (PR preview)
  handle(IPC.GIT_COMPARE_COMMITS, async (_e, repoPath: string, baseBranch: string) => {
    return gitService.getCompareCommits(repoPath, baseBranch)
  })

  handle(IPC.GIT_COMPARE_FILES, async (_e, repoPath: string, baseBranch: string) => {
    return gitService.getCompareFiles(repoPath, baseBranch)
  })

  handle(IPC.GIT_COMPARE_DIFF, async (_e, repoPath: string, baseBranch: string) => {
    return gitService.getCompareDiff(repoPath, baseBranch)
  })

  handle(IPC.GIT_COMPARE_FILE_DIFF, async (_e, repoPath: string, baseBranch: string, filePath: string) => {
    return gitService.getCompareFileDiff(repoPath, baseBranch, filePath)
  })

  handle(IPC.GIT_COMMIT_FULL_DIFF, async (_e, repoPath: string, commitHash: string) => {
    return gitService.getCommitFullDiff(repoPath, commitHash)
  })

  handle(IPC.GIT_WORKING_FILES_PR, async (_e, repoPath: string) => {
    return gitService.getWorkingFilesPR(repoPath)
  })

  handle(IPC.GIT_WORKING_DIFF, async (_e, repoPath: string) => {
    return gitService.getWorkingDiff(repoPath)
  })

  handle(IPC.GIT_SHOW_FILE_BASE64, async (_e, repoPath: string, ref: string, filePath: string) => {
    return gitService.showFileBase64(repoPath, ref, filePath)
  })

  handle(IPC.GIT_SHOW_FILE, async (_e, repoPath: string, ref: string, filePath: string) => {
    return gitService.showFile(repoPath, ref, filePath)
  })

  handle(IPC.GIT_FETCH_AND_PULL, async (_e, repoPath: string, branch: string) => {
    return gitService.fetchAndPull(repoPath, branch)
  })

  handle(IPC.GIT_DISCARD_FILE, async (_e, repoPath: string, filePath: string) => {
    return gitService.discardFile(repoPath, filePath)
  })

  handle(IPC.GIT_STAGE_FILE, async (_e, repoPath: string, filePath: string) => {
    return gitService.stageFile(repoPath, filePath)
  })

  handle(IPC.GIT_UNSTAGE_FILE, async (_e, repoPath: string, filePath: string) => {
    return gitService.unstageFile(repoPath, filePath)
  })

  handle(IPC.GIT_STASH_FILE, async (_e, repoPath: string, filePath: string) => {
    return gitService.stashFile(repoPath, filePath)
  })

  handle(IPC.GIT_REVEAL_FILE, async (_e, absolutePath: string) => {
    shell.showItemInFolder(absolutePath)
  })
}
