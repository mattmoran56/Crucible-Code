import simpleGit from 'simple-git'
import { join, dirname, basename } from 'path'
import { mkdir, access } from 'fs/promises'
import type { WorktreeInfo } from '../../shared/types'

function worktreeDir(repoPath: string): string {
  const repoName = basename(repoPath)
  return join(dirname(repoPath), '.codecrucible-worktrees', repoName)
}

export async function createWorktree(
  repoPath: string,
  sessionName: string,
  baseBranch?: string
): Promise<WorktreeInfo> {
  const g = simpleGit(repoPath)
  const branchName = `session/${sessionName}`
  const wtBase = worktreeDir(repoPath)
  const wtPath = join(wtBase, sessionName)

  await mkdir(wtBase, { recursive: true })

  // Check if repo has any commits
  let hasCommits = true
  try {
    await g.raw(['rev-parse', 'HEAD'])
  } catch {
    hasCommits = false
  }

  if (!hasCommits) {
    // For an empty repo, create an initial commit so worktrees work
    await g.raw(['commit', '--allow-empty', '-m', 'Initial commit'])
  }

  // Determine the base ref
  let base = baseBranch || ''
  if (!base) {
    // Detect the default branch name
    try {
      base = (await g.raw(['symbolic-ref', '--short', 'HEAD'])).trim()
    } catch {
      base = 'HEAD'
    }
  }

  try {
    await g.raw(['worktree', 'add', '-b', branchName, wtPath, base])
  } catch (err) {
    // If the worktree path exists the add succeeded — the error came from a
    // post-checkout hook (e.g. git-lfs not installed). Ignore it.
    await access(wtPath)
  }

  return { path: wtPath, branch: branchName }
}

export async function createWorktreeFromBranch(
  repoPath: string,
  sessionName: string,
  remoteBranch: string
): Promise<WorktreeInfo> {
  const g = simpleGit(repoPath)
  const wtBase = worktreeDir(repoPath)
  const wtPath = join(wtBase, sessionName)

  await mkdir(wtBase, { recursive: true })

  // Fetch the branch from origin
  await g.raw(['fetch', 'origin', remoteBranch])

  // Check if local branch already exists
  let localExists = true
  try {
    await g.raw(['rev-parse', '--verify', remoteBranch])
  } catch {
    localExists = false
  }

  try {
    if (localExists) {
      await g.raw(['worktree', 'add', wtPath, remoteBranch])
    } else {
      await g.raw(['worktree', 'add', '-b', remoteBranch, wtPath, `origin/${remoteBranch}`])
    }
  } catch (err) {
    // If the worktree path exists the add succeeded — the error came from a
    // post-checkout hook (e.g. git-lfs not installed). Ignore it.
    await access(wtPath)
  }

  return { path: wtPath, branch: remoteBranch }
}

export async function listWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
  const g = simpleGit(repoPath)
  const result = await g.raw(['worktree', 'list', '--porcelain'])

  const worktrees: WorktreeInfo[] = []
  let current: Partial<WorktreeInfo> = {}

  for (const line of result.split('\n')) {
    if (line.startsWith('worktree ')) {
      current.path = line.slice('worktree '.length)
    } else if (line.startsWith('branch ')) {
      current.branch = line.slice('branch refs/heads/'.length)
    } else if (line === '') {
      if (current.path && current.branch) {
        worktrees.push(current as WorktreeInfo)
      }
      current = {}
    }
  }

  return worktrees
}

export async function removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
  const g = simpleGit(repoPath)
  await g.raw(['worktree', 'remove', worktreePath, '--force'])
}
