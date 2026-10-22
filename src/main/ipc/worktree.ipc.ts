import { IPC } from '../../shared/constants'
import { handle } from './handle'
import * as worktreeService from '../services/worktree.service'
import * as sandboxerService from '../services/sandboxer.service'
import { cancelJob } from '../services/sandboxer-jobs.service'
import type { SandboxTeardownReport } from '../../shared/types'

/**
 * Remove a worktree and destroy any sandbox built from it, with its data.
 * Sandboxes go first: `sandboxer down` needs the worktree's config to still be
 * on disk. Anything that survives is reaped by `sandboxer gc` once the worktree
 * is gone. The report tells the renderer if a sandbox could not be destroyed.
 */
async function removeWithSandboxes(
  worktreePath: string,
  remove: () => Promise<void>
): Promise<SandboxTeardownReport> {
  // A `sandboxer up` still running would bring the sandbox straight back.
  cancelJob(worktreePath)
  const report = await sandboxerService.teardownForWorktree(worktreePath)
  await remove()
  const survivors = new Set(
    (await sandboxerService.reapAfterRemoval(worktreePath)).map((s) => `${s.project}/${s.slug}`)
  )
  // A `down` that failed but whose sandbox gc then reaped is a success.
  for (const failure of report.failed) {
    const id = failure.slice(0, failure.indexOf(':'))
    if (!survivors.has(id)) report.removed.push(id)
  }
  report.failed = [...survivors].map(
    (id) =>
      report.failed.find((f) => f.startsWith(`${id}:`)) ??
      `${id}: still present after sandboxer down and sandboxer gc`
  )
  return report
}

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
      return removeWithSandboxes(worktreePath, () =>
        worktreeService.removeWorktree(repoPath, worktreePath, opts)
      )
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
    const existing = (await worktreeService.listPRWorktrees(repoPath)).find((w) => w.prNumber === prNumber)
    if (!existing) return worktreeService.removePRWorktree(repoPath, prNumber)
    return removeWithSandboxes(existing.path, () => worktreeService.removePRWorktree(repoPath, prNumber))
  })
}
