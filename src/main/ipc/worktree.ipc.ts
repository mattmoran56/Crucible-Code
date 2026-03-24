import { ipcMain } from 'electron'
import { IPC } from '../../shared/constants'
import * as worktreeService from '../services/worktree.service'

export function registerWorktreeHandlers() {
  ipcMain.handle(
    IPC.WORKTREE_CREATE,
    async (_e, repoPath: string, sessionName: string, baseBranch?: string) => {
      return worktreeService.createWorktree(repoPath, sessionName, baseBranch)
    }
  )

  ipcMain.handle(IPC.WORKTREE_LIST, async (_e, repoPath: string) => {
    return worktreeService.listWorktrees(repoPath)
  })

  ipcMain.handle(IPC.WORKTREE_REMOVE, async (_e, repoPath: string, worktreePath: string) => {
    return worktreeService.removeWorktree(repoPath, worktreePath)
  })

  ipcMain.handle(
    IPC.WORKTREE_CREATE_FROM_BRANCH,
    async (_e, repoPath: string, sessionName: string, remoteBranch: string) => {
      return worktreeService.createWorktreeFromBranch(repoPath, sessionName, remoteBranch)
    }
  )
}
