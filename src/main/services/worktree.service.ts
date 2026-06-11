import simpleGit from 'simple-git'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join, dirname, basename, resolve as resolvePath } from 'path'
import { mkdir, access, realpath } from 'fs/promises'
import type { WorktreeInfo } from '../../shared/types'
import { getDefaultBranch } from './git.service'

const execFileAsync = promisify(execFile)

function worktreeDir(repoPath: string): string {
  const repoName = basename(repoPath)
  return join(dirname(repoPath), '.codecrucible-worktrees', repoName)
}

function prWorktreePath(repoPath: string, prNumber: number): string {
  return join(worktreeDir(repoPath), `pr-${prNumber}`)
}

function isPRWorktreeBasename(name: string): number | null {
  const match = /^pr-(\d+)$/.exec(name)
  return match ? Number(match[1]) : null
}

// `git worktree prune` clears stale administrative entries left behind when a
// worktree's directory is deleted or moved outside of git (e.g. after the
// parent repo itself is moved). Stale entries keep their branch "in use",
// which causes tools like GitHub Desktop to fail with
// `cannot delete branch '...' used by worktree at '...'`.
async function pruneWorktrees(repoPath: string): Promise<void> {
  try {
    await simpleGit(repoPath).raw(['worktree', 'prune'])
  } catch {
    // Best-effort cleanup
  }
}

// If `branch` is currently checked out in some worktree, detach that worktree
// (HEAD becomes detached at the same commit) so we can add a new worktree
// claiming the branch. Returns the path that was detached, or null.
async function detachConflictingWorktree(
  repoPath: string,
  branch: string
): Promise<string | null> {
  const g = simpleGit(repoPath)
  let wtOutput: string
  try {
    wtOutput = await g.raw(['worktree', 'list', '--porcelain'])
  } catch {
    return null
  }
  let wtPath = ''
  for (const line of wtOutput.split('\n')) {
    if (line.startsWith('worktree ')) {
      wtPath = line.slice('worktree '.length)
    } else if (
      line.startsWith('branch refs/heads/') &&
      line.slice('branch refs/heads/'.length) === branch
    ) {
      const wtGit = simpleGit(wtPath)
      await wtGit.raw(['-c', 'core.hooksPath=/dev/null', 'checkout', '--detach'])
      return wtPath
    }
  }
  return null
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
  await pruneWorktrees(repoPath)

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

  // Determine the base ref. When the caller doesn't specify one, use the
  // repository's default branch (from `origin/HEAD`) rather than whatever the
  // main repo happens to be checked out on — otherwise new sessions inherit
  // the staleness of whatever feature branch the user last looked at.
  let base = baseBranch || ''
  if (!base) {
    base = await getDefaultBranch(repoPath)
  }

  // Fetch the latest version of the base branch from origin and prefer the
  // freshly-fetched remote ref when creating the worktree, so we don't branch
  // off a stale local copy if `update-ref` fails for any reason.
  let fetchedRemote = false
  try {
    await g.raw(['fetch', 'origin', base])
    fetchedRemote = true
    // Fast-forward the local ref so subsequent local operations see the latest.
    try {
      await g.raw(['update-ref', `refs/heads/${base}`, `origin/${base}`])
    } catch {
      // Local ref may be checked out elsewhere; the worktree below still
      // branches off origin/<base> so we're fine.
    }
  } catch {
    // Fetch may fail if offline or branch doesn't exist on remote — continue
  }

  const startPoint = fetchedRemote ? `origin/${base}` : base

  try {
    await g.raw(['worktree', 'add', '-b', branchName, wtPath, startPoint])
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
  await pruneWorktrees(repoPath)

  // Fetch the branch from origin
  await g.raw(['fetch', 'origin', remoteBranch])

  // Check if local branch already exists
  let localExists = true
  try {
    await g.raw(['rev-parse', '--verify', remoteBranch])
  } catch {
    localExists = false
  }

  // If the branch is already checked out in another worktree (typically the
  // main repo), git refuses to add a new worktree for it. Detach the
  // conflicting worktree first so HEAD is freed.
  if (localExists) {
    await detachConflictingWorktree(repoPath, remoteBranch)
  }

  try {
    if (localExists) {
      await g.raw(['worktree', 'add', wtPath, remoteBranch])
    } else {
      await g.raw(['worktree', 'add', '-b', remoteBranch, wtPath, `origin/${remoteBranch}`])
    }
  } catch (err) {
    // If the worktree path exists the add succeeded — the error came from a
    // post-checkout hook (e.g. git-lfs not installed). Ignore it. Otherwise
    // surface the real git error instead of the misleading ENOENT from access.
    try {
      await access(wtPath)
    } catch {
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`git worktree add failed: ${message}`)
    }
  }

  return { path: wtPath, branch: remoteBranch }
}

// Rename the branch tied to a session. Resolves the actual current branch via
// (1) reading HEAD from the worktree, or (2) the `worktree list` entry for
// `fallbackBranch`, or (3) verifying `fallbackBranch` exists as-is. This keeps
// renames working when the worktree directory is gone but the branch is still
// around (or vice-versa).
export async function renameWorktreeBranch(
  repoPath: string,
  worktreePath: string,
  fallbackBranch: string,
  newBranch: string
): Promise<{ oldBranch: string; newBranch: string }> {
  const g = simpleGit(repoPath)
  await pruneWorktrees(repoPath)

  let oldBranch = ''
  try {
    oldBranch = (await simpleGit(worktreePath).raw(['symbolic-ref', '--short', 'HEAD'])).trim()
  } catch {
    // Worktree directory missing or not a git repo — fall through.
  }

  if (!oldBranch) {
    try {
      const wtOutput = await g.raw(['worktree', 'list', '--porcelain'])
      for (const line of wtOutput.split('\n')) {
        if (line.startsWith('branch refs/heads/')) {
          const b = line.slice('branch refs/heads/'.length)
          if (b === fallbackBranch) {
            oldBranch = b
            break
          }
        }
      }
    } catch {
      // Best-effort
    }
  }

  if (!oldBranch) {
    try {
      await g.raw(['rev-parse', '--verify', `refs/heads/${fallbackBranch}`])
      oldBranch = fallbackBranch
    } catch {
      throw new Error(`Could not find the branch for this session (tried ${fallbackBranch}). The branch may have been deleted or renamed externally.`)
    }
  }

  if (oldBranch === newBranch) return { oldBranch, newBranch }
  await g.raw(['branch', '-m', oldBranch, newBranch])
  return { oldBranch, newBranch }
}

export async function listWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
  const g = simpleGit(repoPath)
  await pruneWorktrees(repoPath)
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

  // Look up the branch attached to this worktree before we remove it, so we
  // can delete an orphaned `session/*` branch and avoid leaving dangling refs
  // that block branch deletion in other tools (e.g. GitHub Desktop).
  // Normalize both sides via realpath so symlinked paths (e.g. macOS /var vs
  // /private/var) and trailing-slash differences don't cause a miss.
  const normalize = async (p: string): Promise<string> => {
    try {
      return await realpath(p)
    } catch {
      // The path may not exist (e.g. the worktree directory was already
      // deleted). Resolve the parent — usually still present — and re-append
      // the basename so symlinked ancestors (e.g. macOS /var → /private/var)
      // are still followed.
      try {
        const parent = await realpath(dirname(p))
        return join(parent, basename(p))
      } catch {
        return resolvePath(p)
      }
    }
  }
  const targetPath = await normalize(worktreePath)
  let attachedBranch: string | null = null
  try {
    const wtOutput = await g.raw(['worktree', 'list', '--porcelain'])
    let currentPath = ''
    for (const line of wtOutput.split('\n')) {
      if (line.startsWith('worktree ')) {
        currentPath = await normalize(line.slice('worktree '.length))
      } else if (line.startsWith('branch refs/heads/') && currentPath === targetPath) {
        attachedBranch = line.slice('branch refs/heads/'.length)
        break
      }
    }
  } catch {
    // Best-effort lookup
  }

  let removeError: unknown = null
  try {
    await g.raw(['worktree', 'remove', worktreePath, '--force'])
  } catch (err) {
    removeError = err
  }
  await pruneWorktrees(repoPath)

  let removed = removeError === null
  if (removeError) {
    // The remove may have failed simply because the directory was already gone
    // and git's admin entry was stale. After prune, re-check the worktree list:
    // if our target is no longer registered, treat the removal as successful;
    // otherwise surface the original error.
    let stillPresent = true
    try {
      const wtOutput = await g.raw(['worktree', 'list', '--porcelain'])
      stillPresent = false
      for (const line of wtOutput.split('\n')) {
        if (line.startsWith('worktree ')) {
          const p = await normalize(line.slice('worktree '.length))
          if (p === targetPath) {
            stillPresent = true
            break
          }
        }
      }
    } catch {
      // If we can't list, treat the worktree as still present and rethrow.
    }
    if (stillPresent) throw removeError
    removed = true
  }

  if (removed && attachedBranch && attachedBranch.startsWith('session/')) {
    try {
      await g.raw(['branch', '-D', attachedBranch])
    } catch {
      // Branch may not exist or may be checked out elsewhere
    }
  }
}

export interface PRWorktreeInfo {
  prNumber: number
  path: string
  branch: string | null
}

/**
 * Create (or return existing) worktree for a PR. The worktree is placed at
 * `<wtBase>/pr-<num>` and uses `gh pr checkout` so forks and same-repo PRs are
 * handled uniformly. If a worktree already exists at the expected path it's
 * reused — clicking a PR repeatedly should be cheap.
 */
export async function createPRWorktree(
  repoPath: string,
  prNumber: number,
  headRefName: string
): Promise<PRWorktreeInfo> {
  const g = simpleGit(repoPath)
  const wtBase = worktreeDir(repoPath)
  const wtPath = prWorktreePath(repoPath, prNumber)

  await mkdir(wtBase, { recursive: true })
  await pruneWorktrees(repoPath)

  // If the worktree already exists, return it.
  const existing = await findPRWorktree(repoPath, prNumber)
  if (existing) return existing

  // If headRefName is checked out somewhere (e.g. the main repo from the old
  // openPR flow), detach it so gh pr checkout can claim it in our new worktree.
  await detachConflictingWorktree(repoPath, headRefName)

  // Create a detached worktree at the current HEAD, then run `gh pr checkout`
  // inside it. gh handles both fork and same-repo PRs and creates/updates the
  // local branch.
  try {
    await g.raw(['worktree', 'add', '--detach', wtPath, 'HEAD'])
  } catch (err) {
    try {
      await access(wtPath)
    } catch {
      throw new Error(`git worktree add failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  try {
    await execFileAsync('gh', ['pr', 'checkout', String(prNumber), '--force'], {
      cwd: wtPath,
      env: { ...process.env, GIT_LFS_SKIP_SMUDGE: '1' },
    })
  } catch (err) {
    // Roll back the detached worktree so we don't leave a half-broken one behind.
    try { await g.raw(['worktree', 'remove', wtPath, '--force']) } catch {}
    await pruneWorktrees(repoPath)
    throw new Error(`gh pr checkout failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Look up the branch gh checked out so we can report it.
  let branch: string | null = null
  try {
    branch = (await simpleGit(wtPath).raw(['symbolic-ref', '--short', 'HEAD'])).trim() || null
  } catch {
    // Detached — unusual after gh pr checkout but not fatal.
  }

  return { prNumber, path: wtPath, branch }
}

/** Find an existing PR worktree by PR number, if registered with git. */
async function findPRWorktree(
  repoPath: string,
  prNumber: number
): Promise<PRWorktreeInfo | null> {
  const all = await listPRWorktrees(repoPath)
  return all.find((w) => w.prNumber === prNumber) ?? null
}

/** List all PR worktrees registered for this repo (path basename matches `pr-<n>`). */
export async function listPRWorktrees(repoPath: string): Promise<PRWorktreeInfo[]> {
  const g = simpleGit(repoPath)
  await pruneWorktrees(repoPath)
  let output: string
  try {
    output = await g.raw(['worktree', 'list', '--porcelain'])
  } catch {
    return []
  }

  const result: PRWorktreeInfo[] = []
  let curPath = ''
  let curBranch: string | null = null
  const flush = () => {
    if (!curPath) return
    const prNumber = isPRWorktreeBasename(basename(curPath))
    if (prNumber != null) {
      result.push({ prNumber, path: curPath, branch: curBranch })
    }
    curPath = ''
    curBranch = null
  }
  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      flush()
      curPath = line.slice('worktree '.length)
    } else if (line.startsWith('branch refs/heads/')) {
      curBranch = line.slice('branch refs/heads/'.length)
    } else if (line === '') {
      flush()
    }
  }
  flush()
  return result
}

/**
 * Force-remove the PR worktree for `prNumber` and delete the local branch gh
 * created. Used by the auto-teardown path when a PR is merged/closed/gone.
 */
export async function removePRWorktree(
  repoPath: string,
  prNumber: number
): Promise<void> {
  const existing = await findPRWorktree(repoPath, prNumber)
  if (!existing) return

  const g = simpleGit(repoPath)
  try {
    await g.raw(['worktree', 'remove', existing.path, '--force'])
  } catch {
    // Best-effort — prune below will clean up admin entries.
  }
  await pruneWorktrees(repoPath)

  // Delete the branch gh created for this PR. Safe because PR worktrees are
  // disposable — the upstream branch is gone (or merged) by the time we tear
  // down, so the local branch has no further use.
  if (existing.branch) {
    try {
      await g.raw(['branch', '-D', existing.branch])
    } catch {
      // Branch may not exist or still be referenced; that's fine.
    }
  }
}
