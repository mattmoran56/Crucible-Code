import simpleGit from 'simple-git'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join, dirname, basename, resolve as resolvePath, relative, isAbsolute, sep } from 'path'
import { mkdir, access, realpath, rm } from 'fs/promises'
import type { WorktreeInfo } from '../../shared/types'
import { getDefaultBranch } from './git.service'
import { validateBranchName } from '../../shared/branch-name'

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

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

/** realpath, falling back to resolving the parent (the leaf may be gone). */
async function normalizePath(p: string): Promise<string> {
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

/** True when `child` is strictly inside `parent` (never equal to it). */
function isStrictlyInside(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return !!rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

/**
 * Last-resort `rm -rf` of a worktree directory that git left on disk — e.g.
 * the dir is no longer registered with git ("is not a working tree"), git
 * refused to remove it (submodules), or files were recreated after removal.
 *
 * Guarded: only deletes a path strictly inside this repo's
 * `.codecrucible-worktrees/<repo>` base dir — never the base itself, the
 * main checkout, or anything containing it — and never a directory that
 * still holds another registered worktree (session names may nest, e.g.
 * `feat` and `feat/x`). Returns true when the directory is gone afterwards.
 */
async function forceRemoveWorktreeDir(repoPath: string, worktreePath: string): Promise<boolean> {
  if (!(await pathExists(worktreePath))) return true
  const target = await normalizePath(worktreePath)
  const base = await normalizePath(worktreeDir(repoPath))
  const repo = await normalizePath(repoPath)
  if (!isStrictlyInside(base, target)) return false
  if (target === repo || isStrictlyInside(target, repo)) return false

  try {
    const out = await simpleGit(repoPath).raw(['worktree', 'list', '--porcelain'])
    for (const line of out.split('\n')) {
      if (!line.startsWith('worktree ')) continue
      const other = await normalizePath(line.slice('worktree '.length))
      if (isStrictlyInside(target, other)) return false
    }
  } catch {
    // Can't verify nothing else lives under the target — don't delete.
    return false
  }

  try {
    await rm(target, { recursive: true, force: true, maxRetries: 3 })
  } catch {
    // Fall through to the existence check.
  }
  return !(await pathExists(target))
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

async function localBranchExists(repoPath: string, branch: string): Promise<boolean> {
  try {
    // execFile, not simple-git: `--quiet` exits 1 with no stderr, which
    // simple-git does not treat as a failure.
    await execFileAsync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: repoPath })
    return true
  } catch {
    return false
  }
}

/** Branches currently checked out in any worktree of the repo (main included). */
async function checkedOutBranches(repoPath: string): Promise<Set<string>> {
  const out = await simpleGit(repoPath).raw(['worktree', 'list', '--porcelain'])
  const branches = new Set<string>()
  for (const line of out.split('\n')) {
    if (line.startsWith('branch refs/heads/')) branches.add(line.slice('branch refs/heads/'.length))
  }
  return branches
}

function assertDeletableBranch(branch: string): void {
  const invalid = validateBranchName(branch)
  if (invalid) throw new Error(`Invalid branch name "${branch}": ${invalid}`)
}

export async function createWorktree(
  repoPath: string,
  sessionName: string,
  baseBranch?: string,
  requestedBranch?: string
): Promise<WorktreeInfo> {
  const g = simpleGit(repoPath)
  const branchName = requestedBranch?.trim() || `session/${sessionName}`
  const invalid = validateBranchName(branchName)
  if (invalid) throw new Error(`Invalid branch name "${branchName}": ${invalid}`)
  const wtBase = worktreeDir(repoPath)
  const wtPath = join(wtBase, sessionName)

  // The new branch is created with `-b`; refuse up front with a clear message
  // rather than git's terse "a branch named ... already exists".
  if (await localBranchExists(repoPath, branchName)) {
    throw new Error(`A branch named "${branchName}" already exists. Pick a different branch name.`)
  }

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
    // post-checkout hook (e.g. git-lfs not installed). Ignore it. But if the
    // path is genuinely absent the add really failed, so surface the ORIGINAL
    // git error (e.g. "invalid reference: <base>") instead of masking it with a
    // misleading ENOENT from access().
    try {
      await access(wtPath)
    } catch {
      throw err
    }
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

export interface RemoveWorktreeOptions {
  /**
   * Also delete the worktree's branch when it is exactly this name (for
   * app-created branches that do not use the `session/` prefix).
   */
  deleteBranch?: string
}

export async function removeWorktree(
  repoPath: string,
  worktreePath: string,
  opts?: RemoveWorktreeOptions
): Promise<void> {
  const g = simpleGit(repoPath)

  // Look up the branch attached to this worktree before we remove it, so we
  // can delete an orphaned `session/*` branch and avoid leaving dangling refs
  // that block branch deletion in other tools (e.g. GitHub Desktop).
  // Normalize both sides via realpath so symlinked paths (e.g. macOS /var vs
  // /private/var) and trailing-slash differences don't cause a miss.
  const normalize = normalizePath
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

  // `git worktree remove` can fail or leave the directory behind: the dir is
  // no longer registered ("is not a working tree"), it contains submodules,
  // or a process still running in it recreated files. Without this the
  // session vanishes from the UI while its files (node_modules, build output,
  // .env, ...) stay on disk. Guarded to paths inside the worktrees base dir.
  const dirGone = await forceRemoveWorktreeDir(repoPath, worktreePath)
  await pruneWorktrees(repoPath)

  const isStillRegistered = async (): Promise<boolean> => {
    try {
      const wtOutput = await g.raw(['worktree', 'list', '--porcelain'])
      for (const line of wtOutput.split('\n')) {
        if (line.startsWith('worktree ') && (await normalize(line.slice('worktree '.length))) === targetPath) {
          return true
        }
      }
      return false
    } catch {
      // If we can't list, assume it's still present.
      return true
    }
  }

  // The remove may have failed simply because the directory was already gone
  // (or we just deleted it) and git's admin entry was stale. After prune, if
  // our target is no longer registered, treat the removal as successful;
  // otherwise surface the original error.
  if (removeError && (await isStillRegistered())) throw removeError
  if (!dirGone) {
    throw new Error(
      `Worktree directory was not fully removed from disk: ${worktreePath}` +
        (removeError ? ` (${removeError instanceof Error ? removeError.message : String(removeError)})` : '')
    )
  }

  const deletable =
    !!attachedBranch &&
    (attachedBranch.startsWith('session/') || (!!opts?.deleteBranch && attachedBranch === opts.deleteBranch))
  if (attachedBranch && deletable) {
    try {
      await g.raw(['branch', '-D', attachedBranch])
    } catch {
      // Branch may not exist or may be checked out elsewhere
    }
  }
}

/** `git branch --show-current` in the worktree; null when HEAD is detached. */
export async function currentBranch(worktreePath: string): Promise<string | null> {
  const out = (await simpleGit(worktreePath).raw(['branch', '--show-current'])).trim()
  return out || null
}

/**
 * Delete a local branch (`git branch -D`). Refuses the repo's default branch
 * and any branch checked out in a worktree.
 */
export async function deleteLocalBranch(repoPath: string, branch: string): Promise<void> {
  assertDeletableBranch(branch)
  await pruneWorktrees(repoPath)
  if (branch === (await getDefaultBranch(repoPath))) {
    throw new Error(`Refusing to delete the default branch "${branch}"`)
  }
  if ((await checkedOutBranches(repoPath)).has(branch)) {
    throw new Error(`Branch "${branch}" is checked out in a worktree`)
  }
  await simpleGit(repoPath).raw(['branch', '-D', branch])
}

/**
 * Delete a branch on origin (`git push origin --delete`). Refuses the repo's
 * default branch.
 */
export async function deleteRemoteBranch(repoPath: string, branch: string): Promise<void> {
  assertDeletableBranch(branch)
  if (branch === (await getDefaultBranch(repoPath))) {
    throw new Error(`Refusing to delete the default branch "${branch}"`)
  }
  try {
    await execFileAsync('git', ['push', 'origin', '--delete', branch], { cwd: repoPath })
  } catch (err) {
    const e = err as { stderr?: string; message?: string }
    const detail = String(e.stderr || '').trim() || e.message || String(err)
    throw new Error(`Could not delete origin/${branch}: ${detail}`)
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
    await forceRemoveWorktreeDir(repoPath, wtPath)
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
    // Best-effort — the guarded rm and prune below clean up what's left.
  }
  await forceRemoveWorktreeDir(repoPath, existing.path)
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
