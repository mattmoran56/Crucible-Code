import { execFile } from 'child_process'
import { promisify } from 'util'
import type { PullRequest, PRFile, PRComment, PRReviewEvent, PRMergeMethod, PRDetail, PRConversationComment, PRCheck } from '../../shared/types'

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

export async function getPRDiff(repoPath: string, prNumber: number): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('gh', ['pr', 'diff', String(prNumber)], {
      cwd: repoPath,
      maxBuffer: 10 * 1024 * 1024,
    })
    return stdout
  } catch (err) {
    // GitHub returns HTTP 406 when the diff exceeds 300 files
    if (err instanceof Error && err.message.includes('too_large')) {
      return null
    }
    throw err
  }
}

export async function getPRFilePatch(repoPath: string, prNumber: number, filePath: string): Promise<string> {
  const { stdout: repoInfo } = await execFileAsync(
    'gh',
    ['repo', 'view', '--json', 'owner,name'],
    { cwd: repoPath }
  )
  const { owner, name } = JSON.parse(repoInfo) as { owner: { login: string }; name: string }

  // Fetch the specific file from the PR files API
  // The API paginates at 30 files per page, so we need to paginate to find the file
  const { stdout } = await execFileAsync(
    'gh',
    ['api', `repos/${owner.login}/${name}/pulls/${prNumber}/files`, '--paginate', '-q', `.[] | select(.filename == "${filePath}") | .patch`],
    { cwd: repoPath, maxBuffer: 10 * 1024 * 1024 }
  )
  return stdout.trim()
}

export async function getPRFiles(repoPath: string, prNumber: number): Promise<PRFile[]> {
  const { stdout: repoInfo } = await execFileAsync(
    'gh',
    ['repo', 'view', '--json', 'owner,name'],
    { cwd: repoPath }
  )
  const { owner, name } = JSON.parse(repoInfo) as { owner: { login: string }; name: string }

  // Use the REST API with pagination — gh pr view --json files caps at 100
  const { stdout } = await execFileAsync(
    'gh',
    ['api', `repos/${owner.login}/${name}/pulls/${prNumber}/files`, '--paginate', '-q', '.[] | {filename, additions, deletions, status}'],
    { cwd: repoPath, maxBuffer: 10 * 1024 * 1024 }
  )

  // jq outputs one JSON object per line
  const files = stdout.trim().split('\n').filter(Boolean).map((line) => {
    const f = JSON.parse(line) as { filename: string; additions: number; deletions: number; status: string }
    const statusMap: Record<string, string> = {
      added: 'added',
      removed: 'deleted',
      modified: 'modified',
      renamed: 'modified',
      changed: 'modified',
      copied: 'added',
    }
    return {
      path: f.filename,
      additions: f.additions,
      deletions: f.deletions,
      status: statusMap[f.status] || 'modified',
    }
  })
  return files
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

export async function getPRDetail(repoPath: string, prNumber: number): Promise<PRDetail> {
  const { stdout } = await execFileAsync(
    'gh',
    ['pr', 'view', String(prNumber), '--json', 'body,author,title,createdAt,baseRefName,headRefName'],
    { cwd: repoPath }
  )
  const data = JSON.parse(stdout) as {
    body: string
    author: { login: string }
    title: string
    createdAt: string
    baseRefName: string
    headRefName: string
  }
  return {
    body: data.body,
    author: data.author.login,
    title: data.title,
    createdAt: data.createdAt,
    baseRefName: data.baseRefName,
    headRefName: data.headRefName,
  }
}

export async function getPRConversationComments(repoPath: string, prNumber: number): Promise<PRConversationComment[]> {
  try {
    const { stdout: repoInfo } = await execFileAsync(
      'gh',
      ['repo', 'view', '--json', 'owner,name'],
      { cwd: repoPath }
    )
    const { owner, name } = JSON.parse(repoInfo) as { owner: { login: string }; name: string }
    const { stdout } = await execFileAsync(
      'gh',
      ['api', `repos/${owner.login}/${name}/issues/${prNumber}/comments`, '--paginate'],
      { cwd: repoPath, maxBuffer: 5 * 1024 * 1024 }
    )
    const raw = JSON.parse(stdout) as Array<{
      id: number
      body: string
      user: { login: string }
      created_at: string
      author_association: string
    }>
    return raw.map((c) => ({
      id: c.id,
      body: c.body,
      author: c.user.login,
      createdAt: c.created_at,
      authorAssociation: c.author_association,
    }))
  } catch {
    return []
  }
}

export async function getPRChecks(repoPath: string, prNumber: number): Promise<PRCheck[]> {
  try {
    const { stdout } = await execFileAsync(
      'gh',
      ['pr', 'view', String(prNumber), '--json', 'statusCheckRollup'],
      { cwd: repoPath }
    )
    const data = JSON.parse(stdout) as {
      statusCheckRollup: Array<{
        name: string
        status: string
        conclusion: string | null
        startedAt: string | null
        completedAt: string | null
        detailsUrl: string | null
        __typename: string
      }>
    }
    if (!data.statusCheckRollup) return []
    return data.statusCheckRollup.map((c) => ({
      name: c.name || c.__typename,
      status: (c.status?.toLowerCase() || 'pending') as PRCheck['status'],
      conclusion: (c.conclusion?.toLowerCase() || null) as PRCheck['conclusion'],
      startedAt: c.startedAt || null,
      completedAt: c.completedAt || null,
      detailsUrl: c.detailsUrl || null,
    }))
  } catch {
    return []
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
