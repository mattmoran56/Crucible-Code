import { IPC } from '../../shared/constants'
import { handle } from './handle'
import * as worktreeService from '../services/worktree.service'

export function registerWorktreeHandlers() {
  handle(
    IPC.WORKTREE_CREATE,
    async (_e, repoPath: string, sessionName: string, baseBranch?: string) => {
      return worktreeService.createWorktree(repoPath, sessionName, baseBranch)
    }
  )

  handle(IPC.WORKTREE_LIST, async (_e, repoPath: string) => {
    return worktreeService.listWorktrees(repoPath)
  })

  handle(IPC.WORKTREE_REMOVE, async (_e, repoPath: string, worktreePath: string) => {
    return worktreeService.removeWorktree(repoPath, worktreePath)
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
