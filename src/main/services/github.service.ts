import { execFile } from 'child_process'
import { promisify } from 'util'
import type { PullRequest, PRFile, PRComment, PRReviewEvent, PRMergeMethod } from '../../shared/types'

const execFileAsync = promisify(execFile)

export async function listOpenPRs(repoPath: string): Promise<PullRequest[]> {
  try {
    const { stdout } = await execFileAsync(
      'gh',
      [
        'pr',
        'list',
        '--state',
        'open',
        '--json',
        'number,title,headRefName,author,updatedAt,isDraft',
        '--limit',
        '50',
      ],
      { cwd: repoPath }
    )

    const raw = JSON.parse(stdout) as Array<{
      number: number
      title: string
      headRefName: string
      author: { login: string }
      updatedAt: string
      isDraft: boolean
    }>

    return raw.map((pr) => ({
      number: pr.number,
      title: pr.title,
      headRefName: pr.headRefName,
      author: pr.author.login,
      updatedAt: pr.updatedAt,
      isDraft: pr.isDraft,
    }))
  } catch {
    return []
  }
}

export async function getPRDiff(repoPath: string, prNumber: number): Promise<string> {
  const { stdout } = await execFileAsync('gh', ['pr', 'diff', String(prNumber)], {
    cwd: repoPath,
    maxBuffer: 10 * 1024 * 1024,
  })
  return stdout
}

export async function getPRFiles(repoPath: string, prNumber: number): Promise<PRFile[]> {
  const { stdout } = await execFileAsync(
    'gh',
    ['pr', 'view', String(prNumber), '--json', 'files'],
    { cwd: repoPath }
  )
  const data = JSON.parse(stdout) as {
    files: Array<{ path: string; additions: number; deletions: number }>
  }
  return data.files.map((f) => ({
    path: f.path,
    additions: f.additions,
    deletions: f.deletions,
    status: f.additions > 0 && f.deletions > 0 ? 'modified' : f.deletions > 0 ? 'deleted' : 'added',
  }))
}

export async function getPRComments(repoPath: string, prNumber: number): Promise<PRComment[]> {
  try {
    const { stdout: repoInfo } = await execFileAsync(
      'gh',
      ['repo', 'view', '--json', 'owner,name'],
      { cwd: repoPath }
    )
    const { owner, name } = JSON.parse(repoInfo) as { owner: { login: string }; name: string }
    const { stdout } = await execFileAsync(
      'gh',
      ['api', `repos/${owner.login}/${name}/pulls/${prNumber}/comments`, '--paginate'],
      { cwd: repoPath, maxBuffer: 5 * 1024 * 1024 }
    )
    const raw = JSON.parse(stdout) as Array<{
      id: number
      body: string
      path: string
      line: number | null
      side: 'LEFT' | 'RIGHT'
      user: { login: string }
      created_at: string
    }>
    return raw.map((c) => ({
      id: c.id,
      body: c.body,
      path: c.path,
      line: c.line,
      side: c.side || 'RIGHT',
      author: c.user.login,
      createdAt: c.created_at,
    }))
  } catch {
    return []
  }
}

export async function createPRComment(
  repoPath: string,
  prNumber: number,
  body: string,
  path: string,
  line: number,
  startLine?: number,
  side?: 'LEFT' | 'RIGHT'
): Promise<PRComment> {
  const { stdout: repoInfo } = await execFileAsync(
    'gh',
    ['repo', 'view', '--json', 'owner,name'],
    { cwd: repoPath }
  )
  const { owner, name } = JSON.parse(repoInfo) as { owner: { login: string }; name: string }

  // Get the head commit SHA for this PR
  const { stdout: prInfo } = await execFileAsync(
    'gh',
    ['pr', 'view', String(prNumber), '--json', 'headRefOid'],
    { cwd: repoPath }
  )
  const { headRefOid } = JSON.parse(prInfo) as { headRefOid: string }

  const args = [
    'api',
    `repos/${owner.login}/${name}/pulls/${prNumber}/comments`,
    '-f', `body=${body}`,
    '-f', `path=${path}`,
    '-F', `line=${line}`,
    '-f', `side=${side || 'RIGHT'}`,
    '-f', `commit_id=${headRefOid}`,
  ]
  if (startLine != null) {
    args.push('-F', `start_line=${startLine}`)
    args.push('-f', `start_side=${side || 'RIGHT'}`)
  }

  const { stdout } = await execFileAsync('gh', args, { cwd: repoPath })
  const c = JSON.parse(stdout) as {
    id: number
    body: string
    path: string
    line: number | null
    side: 'LEFT' | 'RIGHT'
    user: { login: string }
    created_at: string
  }
  return {
    id: c.id,
    body: c.body,
    path: c.path,
    line: c.line,
    side: c.side || 'RIGHT',
    author: c.user.login,
    createdAt: c.created_at,
  }
}

export async function submitPRReview(
  repoPath: string,
  prNumber: number,
  event: PRReviewEvent,
  body?: string
): Promise<void> {
  const flag =
    event === 'APPROVE' ? '--approve' :
    event === 'REQUEST_CHANGES' ? '--request-changes' :
    '--comment'
  const args = ['pr', 'review', String(prNumber), flag]
  if (body) {
    args.push('-b', body)
  }
  await execFileAsync('gh', args, { cwd: repoPath })
}

export async function getPRMergeability(
  repoPath: string,
  prNumber: number
): Promise<{ mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN' }> {
  try {
    const { stdout } = await execFileAsync(
      'gh',
      ['pr', 'view', String(prNumber), '--json', 'mergeable'],
      { cwd: repoPath }
    )
    const data = JSON.parse(stdout) as { mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN' }
    return data
  } catch {
    return { mergeable: 'UNKNOWN' }
  }
}

export async function mergePR(
  repoPath: string,
  prNumber: number,
  method: PRMergeMethod = 'merge'
): Promise<void> {
  await execFileAsync(
    'gh',
    ['pr', 'merge', String(prNumber), `--${method}`, '--delete-branch'],
    { cwd: repoPath }
  )
}
