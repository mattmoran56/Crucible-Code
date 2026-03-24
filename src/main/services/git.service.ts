import simpleGit, { SimpleGit } from 'simple-git'
import type { Commit, FileDiff } from '../../shared/types'

function git(repoPath: string): SimpleGit {
  return simpleGit(repoPath)
}

/** Git instance with LFS hooks suppressed — use for checkout operations */
function gitNoLFS(repoPath: string): SimpleGit {
  return simpleGit({
    baseDir: repoPath,
    unsafe: { allowUnsafeHooksPath: true },
  }).env('GIT_LFS_SKIP_SMUDGE', '1')
}

export async function getStatus(repoPath: string) {
  const status = await git(repoPath).status()
  return status
}

export async function getLog(repoPath: string, maxCount = 50): Promise<Commit[]> {
  const log = await git(repoPath).log({ maxCount })
  return log.all.map((entry) => ({
    hash: entry.hash,
    message: entry.message,
    author: entry.author_name,
    date: entry.date,
  }))
}

export async function getDiff(repoPath: string, commitHash: string): Promise<FileDiff[]> {
  const g = git(repoPath)
  const diff = await g.diffSummary([`${commitHash}~1`, commitHash])
  return diff.files.map((f) => ({
    filePath: f.file,
    status: f.binary
      ? 'modified'
      : (f as any).status === 'added'
        ? 'added'
        : (f as any).status === 'deleted'
          ? 'deleted'
          : 'modified',
    insertions: (f as any).insertions ?? 0,
    deletions: (f as any).deletions ?? 0,
  }))
}

export async function getFileDiff(
  repoPath: string,
  commitHash: string,
  filePath: string
): Promise<string> {
  const g = git(repoPath)
  const patch = await g.diff([`${commitHash}~1`, commitHash, '--', filePath])
  return patch
}

export interface CheckoutResult {
  stashed: boolean
  detachedWorktree?: string // worktree path that was detached to free the branch
  error?: string
}

export async function checkoutBranch(
  repoPath: string,
  branch: string
): Promise<CheckoutResult> {
  const g = git(repoPath)
  const gc = gitNoLFS(repoPath)

  try {
    await g.raw(['fetch', 'origin', branch])
  } catch (err) {
    return { stashed: false, error: err instanceof Error ? err.message : String(err) }
  }

  // Stash any uncommitted changes
  const status = await g.status()
  const dirty =
    status.modified.length > 0 ||
    status.not_added.length > 0 ||
    status.created.length > 0 ||
    status.deleted.length > 0 ||
    status.staged.length > 0
  let stashed = false

  if (dirty) {
    await g.raw([
      'stash',
      'push',
      '-m',
      `codecrucible: auto-stash before switching to ${branch}`,
    ])
    stashed = true
  }

  // Try simple checkout first
  try {
    await gc.raw(['-c', 'core.hooksPath=/dev/null', 'checkout', branch])
    return { stashed }
  } catch {
    // May not exist locally, or is in a worktree
  }

  // Try creating from origin
  try {
    await gc.raw(['-c', 'core.hooksPath=/dev/null', 'checkout', '-b', branch, `origin/${branch}`])
    return { stashed }
  } catch {
    // Branch exists locally — likely in a worktree
  }

  // Find which worktree has this branch and detach it
  let detachedWorktree: string | undefined
  try {
    const wtOutput = await g.raw(['worktree', 'list', '--porcelain'])
    let wtPath = ''
    for (const line of wtOutput.split('\n')) {
      if (line.startsWith('worktree ')) {
        wtPath = line.slice('worktree '.length)
      } else if (line.startsWith('branch refs/heads/') && line.slice('branch refs/heads/'.length) === branch) {
        // This worktree has our branch — detach it
        const wtGit = gitNoLFS(wtPath)
        await wtGit.raw(['-c', 'core.hooksPath=/dev/null', 'checkout', '--detach'])
        detachedWorktree = wtPath
        break
      }
    }
  } catch (err) {
    return { stashed, error: err instanceof Error ? err.message : String(err) }
  }

  // Now the branch should be free — checkout
  try {
    await gc.raw(['-c', 'core.hooksPath=/dev/null', 'checkout', branch])
    return { stashed, detachedWorktree }
  } catch (err) {
    return { stashed, detachedWorktree, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function restoreWorktreeBranch(worktreePath: string, branch: string): Promise<void> {
  const g = gitNoLFS(worktreePath)
  await g.raw(['-c', 'core.hooksPath=/dev/null', 'checkout', branch])
}

export async function pushBranch(repoPath: string): Promise<void> {
  const g = git(repoPath)
  const status = await g.status()
  const branch = status.current ?? 'HEAD'
  await g.raw(['push', 'origin', branch, '--set-upstream'])
}

export async function getRemoteUrl(repoPath: string): Promise<string | null> {
  try {
    const g = git(repoPath)
    const url = await g.remote(['get-url', 'origin'])
    return url?.trim() ?? null
  } catch {
    return null
  }
}

export function remoteUrlToGitHub(remoteUrl: string): string | null {
  // https://github.com/owner/repo.git  or  git@github.com:owner/repo.git
  const httpsMatch = remoteUrl.match(/https:\/\/github\.com\/(.+?)(?:\.git)?$/)
  if (httpsMatch) return `https://github.com/${httpsMatch[1]}`
  const sshMatch = remoteUrl.match(/git@github\.com:(.+?)(?:\.git)?$/)
  if (sshMatch) return `https://github.com/${sshMatch[1]}`
  return null
}

export async function listBranches(repoPath: string): Promise<string[]> {
  const g = git(repoPath)
  const result = await g.branch(['-a'])
  return result.all
    .map((b) => b.replace(/^remotes\/origin\//, '').trim())
    .filter((b) => !b.startsWith('HEAD'))
    .filter((v, i, arr) => arr.indexOf(v) === i) // dedupe
    .sort()
}

export interface MergeCheckResult {
  hasConflicts: boolean
}

export async function checkMerge(repoPath: string, branch: string): Promise<MergeCheckResult> {
  const g = git(repoPath)
  try {
    const mergeBase = await g.raw(['merge-base', 'HEAD', branch])
    const mergeTree = await g.raw(['merge-tree', mergeBase.trim(), 'HEAD', branch])
    const hasConflicts = mergeTree.includes('<<<<<<<')
    return { hasConflicts }
  } catch {
    return { hasConflicts: true }
  }
}

export async function mergeBranch(repoPath: string, branch: string): Promise<void> {
  const g = git(repoPath)
  await g.merge([branch])
}

export async function getWorkingFileDiff(repoPath: string, filePath: string): Promise<string> {
  const g = git(repoPath)
  const staged = await g.diff(['--cached', '--', filePath])
  const unstaged = await g.diff(['--', filePath])
  return [staged, unstaged].filter(Boolean).join('\n')
}

export interface CommitStatuses {
  unpushedHashes: string[]
  newBranchHashes: string[]
}

export async function getCommitStatuses(repoPath: string): Promise<CommitStatuses> {
  const g = git(repoPath)
  const status = await g.status()
  const branch = status.current ?? 'HEAD'

  let unpushedHashes: string[] = []
  try {
    const result = await g.raw(['log', `origin/${branch}..HEAD`, '--format=%H'])
    unpushedHashes = result.trim().split('\n').filter(Boolean)
  } catch {
    // No remote branch yet — all local commits are unpushed
    try {
      const result = await g.raw(['log', 'HEAD', '--format=%H'])
      unpushedHashes = result.trim().split('\n').filter(Boolean)
    } catch {}
  }

  let newBranchHashes: string[] = []
  for (const base of ['main', 'master']) {
    try {
      const result = await g.raw(['log', `${base}..HEAD`, '--format=%H'])
      newBranchHashes = result.trim().split('\n').filter(Boolean)
      break
    } catch {}
  }

  return { unpushedHashes, newBranchHashes }
}

export async function getWorkingDiff(repoPath: string): Promise<string> {
  const g = git(repoPath)
  // Show both staged and unstaged changes
  const unstaged = await g.diff()
  const staged = await g.diff(['--cached'])
  return [staged, unstaged].filter(Boolean).join('\n')
}

export async function isBranchMerged(
  worktreePath: string,
  baseBranch: string
): Promise<boolean> {
  const g = git(worktreePath)
  try {
    await g.raw(['fetch', 'origin', baseBranch, '--quiet'])
  } catch {
    // If fetch fails, fall back to local state
  }
  try {
    // Uncommitted changes mean active work — not stale
    const status = await g.status()
    const dirty =
      status.modified.length > 0 ||
      status.not_added.length > 0 ||
      status.created.length > 0 ||
      status.deleted.length > 0 ||
      status.staged.length > 0
    if (dirty) return false

    // Commits on HEAD not in base — if any exist, session has work in progress
    const aheadOut = await g.raw(['rev-list', '--count', `origin/${baseBranch}..HEAD`])
    const ahead = parseInt(aheadOut.trim(), 10)
    if (ahead > 0) return false

    // No local commits and no uncommitted changes — stale (merged or never started)
    return true
  } catch {
    return false
  }
}

export async function getWorkingChangedFiles(repoPath: string): Promise<FileDiff[]> {
  const status = await git(repoPath).status()
  const files: FileDiff[] = []

  for (const f of status.modified) {
    files.push({ filePath: f, status: 'modified', insertions: 0, deletions: 0 })
  }
  for (const f of status.not_added) {
    files.push({ filePath: f, status: 'added', insertions: 0, deletions: 0 })
  }
  for (const f of status.created) {
    files.push({ filePath: f, status: 'added', insertions: 0, deletions: 0 })
  }
  for (const f of status.deleted) {
    files.push({ filePath: f, status: 'deleted', insertions: 0, deletions: 0 })
  }
  for (const f of status.renamed) {
    files.push({ filePath: (f as any).to ?? f, status: 'renamed', insertions: 0, deletions: 0 })
  }

  return files
}
