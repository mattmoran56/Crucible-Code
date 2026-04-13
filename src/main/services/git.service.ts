import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import simpleGit, { SimpleGit } from 'simple-git'
import type { Commit, FileDiff, PRFile } from '../../shared/types'

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
  // Check if commit has a parent; root commits need special handling
  let parentRef = `${commitHash}~1`
  try {
    await g.raw(['rev-parse', '--verify', parentRef])
  } catch {
    // Root commit: diff against the git empty tree
    parentRef = '4b825dc642cb6eb9a060e54bf899d69f82cf7202'
  }
  const diff = await g.diffSummary([parentRef, commitHash])
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
  // Check if commit has a parent; root commits need special handling
  let hasParent = true
  try {
    await g.raw(['rev-parse', '--verify', `${commitHash}~1`])
  } catch {
    hasParent = false
  }
  if (hasParent) {
    return g.diff([`${commitHash}~1`, commitHash, '--', filePath])
  }
  // Root commit: diff against empty tree
  return g.diff(['4b825dc642cb6eb9a060e54bf899d69f82cf7202', commitHash, '--', filePath])
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

  // Try local checkout first — fastest path for worktree branches
  try {
    await gc.raw(['-c', 'core.hooksPath=/dev/null', 'checkout', branch])
    return { stashed }
  } catch {
    // May not exist locally, or is in a worktree
  }

  // Fetch from remote, then try creating a local tracking branch
  try {
    await g.raw(['fetch', 'origin', branch])
  } catch {
    // Branch may only exist locally (e.g. in a worktree) — continue
  }

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

export async function getDefaultBranch(repoPath: string): Promise<string> {
  const g = git(repoPath)
  try {
    const ref = (await g.raw(['symbolic-ref', 'refs/remotes/origin/HEAD'])).trim()
    return ref.replace(/^refs\/remotes\/origin\//, '')
  } catch {
    try {
      return (await g.raw(['symbolic-ref', '--short', 'HEAD'])).trim()
    } catch {
      return 'main'
    }
  }
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
  const patch = [staged, unstaged].filter(Boolean).join('\n')
  if (patch) return patch

  // Untracked file: git diff won't show anything, so build a synthetic diff
  try {
    const content = await readFile(join(repoPath, filePath), 'utf-8')
    const lines = content.split('\n')
    // Remove trailing empty line from final newline
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
    const lineCount = lines.length
    const body = lines.map((l) => `+${l}`).join('\n')
    return `--- /dev/null\n+++ b/${filePath}\n@@ -0,0 +1,${lineCount} @@\n${body}\n`
  } catch {
    return ''
  }
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

// ── Branch comparison (PR preview) ─────────────────────────────────────────

const STATUS_MAP: Record<string, string> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
}

export async function getCompareFiles(repoPath: string, baseBranch: string): Promise<PRFile[]> {
  const g = git(repoPath)
  const ref = `${baseBranch}...HEAD`

  // Get line stats
  const numstat = await g.raw(['diff', '--numstat', ref])
  const statsMap = new Map<string, { additions: number; deletions: number }>()
  for (const line of numstat.trim().split('\n').filter(Boolean)) {
    const [add, del, ...pathParts] = line.split('\t')
    const filePath = pathParts.join('\t') // handle paths with tabs (renames)
    statsMap.set(filePath, {
      additions: add === '-' ? 0 : parseInt(add, 10),
      deletions: del === '-' ? 0 : parseInt(del, 10),
    })
  }

  // Get file statuses
  const nameStatus = await g.raw(['diff', '--name-status', ref])
  const files: PRFile[] = []
  for (const line of nameStatus.trim().split('\n').filter(Boolean)) {
    const [statusCode, ...pathParts] = line.split('\t')
    // Renames have two paths: old\tnew — use the new path
    const filePath = pathParts.length > 1 ? pathParts[pathParts.length - 1] : pathParts[0]
    const status = STATUS_MAP[statusCode.charAt(0)] || 'modified'
    const stats = statsMap.get(filePath) || statsMap.get(pathParts[0]) || { additions: 0, deletions: 0 }
    files.push({ path: filePath, status, ...stats })
  }

  return files
}

export async function getCompareDiff(repoPath: string, baseBranch: string): Promise<string> {
  return git(repoPath).diff([`${baseBranch}...HEAD`])
}

export async function getCompareFileDiff(
  repoPath: string,
  baseBranch: string,
  filePath: string
): Promise<string> {
  return git(repoPath).diff([`${baseBranch}...HEAD`, '--', filePath])
}

export async function getCompareCommits(repoPath: string, baseBranch: string): Promise<Commit[]> {
  const g = git(repoPath)
  const log = await g.log({ from: baseBranch, to: 'HEAD' })
  return log.all.map((entry) => ({
    hash: entry.hash,
    message: entry.message,
    author: entry.author_name,
    date: entry.date,
  }))
}

export async function getCommitFullDiff(repoPath: string, commitHash: string): Promise<string> {
  const g = git(repoPath)
  let parentRef = `${commitHash}~1`
  try {
    await g.raw(['rev-parse', '--verify', parentRef])
  } catch {
    parentRef = '4b825dc642cb6eb9a060e54bf899d69f82cf7202'
  }
  return g.diff([parentRef, commitHash])
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
