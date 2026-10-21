import { IPC } from '../../shared/constants'
import { handle } from './handle'
import * as worktreeService from '../services/worktree.service'

export function registerWorktreeHandlers() {
  handle(
    IPC.WORKTREE_CREATE,
    async (_e, repoPath: string, sessionName: string, baseBranch?: string, branchName?: string) => {
      return worktreeService.createWorktree(repoPath, sessionName, baseBranch, branchName)
    }
  )

  handle(IPC.WORKTREE_LIST, async (_e, repoPath: string) => {
    return worktreeService.listWorktrees(repoPath)
  })

  handle(
    IPC.WORKTREE_REMOVE,
    async (_e, repoPath: string, worktreePath: string, opts?: worktreeService.RemoveWorktreeOptions) => {
      return worktreeService.removeWorktree(repoPath, worktreePath, opts)
    }
  )

  handle(IPC.WORKTREE_CURRENT_BRANCH, async (_e, worktreePath: string) => {
    return worktreeService.currentBranch(worktreePath)
  })

  handle(IPC.WORKTREE_DELETE_LOCAL_BRANCH, async (_e, repoPath: string, branch: string) => {
    return worktreeService.deleteLocalBranch(repoPath, branch)
  })

  handle(IPC.WORKTREE_DELETE_REMOTE_BRANCH, async (_e, repoPath: string, branch: string) => {
    return worktreeService.deleteRemoteBranch(repoPath, branch)
  })

  handle(
    IPC.WORKTREE_CREATE_FROM_BRANCH,
    async (_e, repoPath: string, sessionName: string, remoteBranch: string) => {
      return worktreeService.createWorktreeFromBranch(repoPath, sessionName, remoteBranch)
    }
  )

  handle(
    IPC.WORKTREE_RENAME_BRANCH,
    async (_e, repoPath: string, worktreePath: string, fallbackBranch: string, newBranch: string) => {
      return worktreeService.renameWorktreeBranch(repoPath, worktreePath, fallbackBranch, newBranch)
    }
  )

  handle(
    IPC.WORKTREE_CREATE_FOR_PR,
    async (_e, repoPath: string, prNumber: number, headRefName: string) => {
      return worktreeService.createPRWorktree(repoPath, prNumber, headRefName)
    }
  )

  handle(IPC.WORKTREE_LIST_PR, async (_e, repoPath: string) => {
    return worktreeService.listPRWorktrees(repoPath)
  })

  handle(IPC.WORKTREE_REMOVE_PR, async (_e, repoPath: string, prNumber: number) => {
    return worktreeService.removePRWorktree(repoPath, prNumber)
  })
}
