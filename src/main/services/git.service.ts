import simpleGit, { SimpleGit } from 'simple-git'
import type { Commit, FileDiff } from '../../shared/types'

function git(repoPath: string): SimpleGit {
  return simpleGit(repoPath)
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

export async function checkoutBranch(repoPath: string, branch: string): Promise<void> {
  const g = git(repoPath)
  await g.raw(['fetch', 'origin', branch])
  // Try checking out existing local branch, or create from origin
  try {
    await g.raw(['checkout', branch])
  } catch {
    await g.raw(['checkout', '-b', branch, `origin/${branch}`])
  }
}

export async function getWorkingDiff(repoPath: string): Promise<string> {
  const g = git(repoPath)
  // Show both staged and unstaged changes
  const unstaged = await g.diff()
  const staged = await g.diff(['--cached'])
  return [staged, unstaged].filter(Boolean).join('\n')
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
