import { execFile } from 'child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'util'
import type { PullRequest, PRFile, PRComment, PRReviewEvent, PRMergeMethod, PRDetail, PRConversationComment, PRCheck, Commit, PRReviewThread, CIStatus, PRReviewState, PRReviewSummary, GitHubCollaborator } from '../../shared/types'

const execFileAsync = promisify(execFile)

async function getRepoOwnerName(repoPath: string): Promise<{ owner: string; name: string }> {
  const { stdout } = await execFileAsync(
    'gh',
    ['repo', 'view', '--json', 'owner,name'],
    { cwd: repoPath }
  )
  const parsed = JSON.parse(stdout) as { owner: { login: string }; name: string }
  return { owner: parsed.owner.login, name: parsed.name }
}

function deriveCIStatus(rollup: Array<{ status?: string | null; conclusion?: string | null }> | null | undefined): CIStatus {
  if (!rollup || rollup.length === 0) return 'none'
  const isPending = rollup.some((c) => {
    const s = c.status?.toLowerCase()
    return s && s !== 'completed'
  })
  if (isPending) return 'pending'
  const failureConclusions = new Set(['failure', 'cancelled', 'timed_out', 'action_required'])
  const isFailure = rollup.some((c) => {
    const concl = c.conclusion?.toLowerCase()
    return concl ? failureConclusions.has(concl) : false
  })
  return isFailure ? 'failure' : 'success'
}

export async function listOpenPRs(repoPath: string): Promise<PullRequest[]> {
  const fields = 'number,title,headRefName,baseRefName,author,updatedAt,isDraft,state,statusCheckRollup'

  async function fetchPRs(state: string): Promise<PullRequest[]> {
    try {
      const { stdout } = await execFileAsync(
        'gh',
        ['pr', 'list', '--state', state, '--json', fields, '--limit', '50'],
        { cwd: repoPath }
      )

      const raw = JSON.parse(stdout) as Array<{
        number: number
        title: string
        headRefName: string
        baseRefName: string
        author: { login: string }
        updatedAt: string
        isDraft: boolean
        state: string
        statusCheckRollup?: Array<{ status?: string | null; conclusion?: string | null }> | null
      }>

      return raw.map((pr) => ({
        number: pr.number,
        title: pr.title,
        headRefName: pr.headRefName,
        baseRefName: pr.baseRefName,
        author: pr.author.login,
        updatedAt: pr.updatedAt,
        isDraft: pr.isDraft,
        state: pr.state === 'MERGED' ? 'MERGED' as const : 'OPEN' as const,
        ciStatus: deriveCIStatus(pr.statusCheckRollup),
      }))
    } catch {
      return []
    }
  }

  const [open, merged] = await Promise.all([
    fetchPRs('open'),
    fetchPRs('merged'),
  ])

  return [...open, ...merged]
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
    const { owner, name } = await getRepoOwnerName(repoPath)
    const { stdout } = await execFileAsync(
      'gh',
      ['api', `repos/${owner}/${name}/pulls/${prNumber}/comments`, '--paginate'],
      { cwd: repoPath, maxBuffer: 5 * 1024 * 1024 }
    )
    const raw = JSON.parse(stdout) as Array<{
      id: number
      body: string
      path: string
      line: number | null
      start_line?: number | null
      side: 'LEFT' | 'RIGHT'
      user: { login: string }
      created_at: string
      in_reply_to_id?: number | null
    }>
    return raw.map((c) => ({
      id: c.id,
      body: c.body,
      path: c.path,
      line: c.line,
      startLine: c.start_line ?? null,
      side: c.side || 'RIGHT',
      author: c.user.login,
      createdAt: c.created_at,
      inReplyToId: c.in_reply_to_id ?? null,
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
  const { owner, name } = await getRepoOwnerName(repoPath)

  const { stdout: prInfo } = await execFileAsync(
    'gh',
    ['pr', 'view', String(prNumber), '--json', 'headRefOid'],
    { cwd: repoPath }
  )
  const { headRefOid } = JSON.parse(prInfo) as { headRefOid: string }

  const args = [
    'api',
    `repos/${owner}/${name}/pulls/${prNumber}/comments`,
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
    start_line?: number | null
    side: 'LEFT' | 'RIGHT'
    user: { login: string }
    created_at: string
    in_reply_to_id?: number | null
  }
  return {
    id: c.id,
    body: c.body,
    path: c.path,
    line: c.line,
    startLine: c.start_line ?? null,
    side: c.side || 'RIGHT',
    author: c.user.login,
    createdAt: c.created_at,
    inReplyToId: c.in_reply_to_id ?? null,
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
  const fields = [
    'body',
    'author',
    'title',
    'createdAt',
    'baseRefName',
    'headRefName',
    'baseRefOid',
    'headRefOid',
    'reviewRequests',
    'latestReviews',
    'reviews',
  ].join(',')
  const { stdout } = await execFileAsync(
    'gh',
    ['pr', 'view', String(prNumber), '--json', fields],
    { cwd: repoPath }
  )
  const data = JSON.parse(stdout) as {
    body: string
    author: { login: string }
    title: string
    createdAt: string
    baseRefName: string
    headRefName: string
    baseRefOid?: string
    headRefOid?: string
    reviewRequests?: Array<{ login?: string; name?: string; __typename?: string }>
    latestReviews?: Array<{ author: { login: string }; state: string; submittedAt: string }>
    reviews?: Array<{ author: { login: string }; state: string; submittedAt: string }>
  }

  const requestedReviewers = (data.reviewRequests || [])
    .map((r) => r.login || r.name || '')
    .filter(Boolean)

  // Prefer latestReviews; fall back to dedup-by-author across all reviews
  let reviews: PRReviewSummary[] = []
  if (data.latestReviews && data.latestReviews.length > 0) {
    reviews = data.latestReviews.map((r) => ({
      author: r.author.login,
      state: (r.state.toUpperCase() as PRReviewState),
      submittedAt: r.submittedAt,
    }))
  } else if (data.reviews && data.reviews.length > 0) {
    const byAuthor = new Map<string, PRReviewSummary>()
    const sorted = [...data.reviews].sort((a, b) =>
      a.submittedAt.localeCompare(b.submittedAt)
    )
    for (const r of sorted) {
      byAuthor.set(r.author.login, {
        author: r.author.login,
        state: r.state.toUpperCase() as PRReviewState,
        submittedAt: r.submittedAt,
      })
    }
    reviews = [...byAuthor.values()]
  }

  return {
    body: data.body,
    author: data.author.login,
    title: data.title,
    createdAt: data.createdAt,
    baseRefName: data.baseRefName,
    headRefName: data.headRefName,
    baseRefOid: data.baseRefOid,
    headRefOid: data.headRefOid,
    requestedReviewers,
    reviews,
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

export async function getPRCommits(repoPath: string, prNumber: number): Promise<Commit[]> {
  const { stdout } = await execFileAsync(
    'gh',
    ['pr', 'view', String(prNumber), '--json', 'commits'],
    { cwd: repoPath }
  )
  const data = JSON.parse(stdout) as {
    commits: Array<{
      oid: string
      messageHeadline: string
      authors: Array<{ login?: string; name: string }>
      committedDate: string
    }>
  }
  return data.commits.map((c) => ({
    hash: c.oid,
    message: c.messageHeadline,
    author: c.authors[0]?.login || c.authors[0]?.name || 'unknown',
    date: c.committedDate,
  }))
}

export async function getCommitDiff(repoPath: string, commitHash: string): Promise<string> {
  const { stdout } = await execFileAsync(
    'git',
    ['diff', `${commitHash}~1..${commitHash}`],
    { cwd: repoPath, maxBuffer: 10 * 1024 * 1024 }
  )
  return stdout
}

export async function getPRReviewThreads(repoPath: string, prNumber: number): Promise<PRReviewThread[]> {
  try {
    const { owner, name } = await getRepoOwnerName(repoPath)

    const query = `query {
      repository(owner: "${owner}", name: "${name}") {
        pullRequest(number: ${prNumber}) {
          reviewThreads(first: 100) {
            nodes {
              id
              isResolved
              path
              line
              startLine
              diffSide
              comments(first: 100) {
                nodes {
                  databaseId
                  body
                  path
                  line
                  startLine
                  author { login }
                  createdAt
                  replyTo { databaseId }
                }
              }
            }
          }
        }
      }
    }`

    const { stdout } = await execFileAsync(
      'gh',
      ['api', 'graphql', '-f', `query=${query}`],
      { cwd: repoPath, maxBuffer: 5 * 1024 * 1024 }
    )
    const data = JSON.parse(stdout) as {
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: Array<{
                id: string
                isResolved: boolean
                path: string
                line: number | null
                startLine: number | null
                diffSide: 'LEFT' | 'RIGHT' | null
                comments: {
                  nodes: Array<{
                    databaseId: number
                    body: string
                    path: string
                    line: number | null
                    startLine: number | null
                    author: { login: string } | null
                    createdAt: string
                    replyTo: { databaseId: number } | null
                  }>
                }
              }>
            }
          }
        }
      }
    }

    return data.data.repository.pullRequest.reviewThreads.nodes.map((t) => {
      const comments: PRComment[] = t.comments.nodes.map((c) => ({
        id: c.databaseId,
        body: c.body,
        path: c.path,
        line: c.line,
        startLine: c.startLine ?? null,
        side: (t.diffSide ?? 'RIGHT') as 'LEFT' | 'RIGHT',
        author: c.author?.login ?? 'unknown',
        createdAt: c.createdAt,
        inReplyToId: c.replyTo?.databaseId ?? null,
      }))
      const root = comments[0]
      return {
        id: t.id,
        path: t.path,
        line: t.line,
        startLine: t.startLine ?? null,
        side: (t.diffSide ?? 'RIGHT') as 'LEFT' | 'RIGHT',
        isResolved: t.isResolved,
        rootCommentId: root?.id ?? null,
        comments,
      }
    })
  } catch {
    return []
  }
}

// ── Reviewers ─────────────────────────────────────────────────────────────

export async function addPRReviewer(repoPath: string, prNumber: number, login: string): Promise<void> {
  await execFileAsync(
    'gh',
    ['pr', 'edit', String(prNumber), '--add-reviewer', login],
    { cwd: repoPath }
  )
}

export async function removePRReviewer(repoPath: string, prNumber: number, login: string): Promise<void> {
  await execFileAsync(
    'gh',
    ['pr', 'edit', String(prNumber), '--remove-reviewer', login],
    { cwd: repoPath }
  )
}

export async function listCollaborators(repoPath: string): Promise<GitHubCollaborator[]> {
  try {
    const { owner, name } = await getRepoOwnerName(repoPath)
    const { stdout } = await execFileAsync(
      'gh',
      ['api', `repos/${owner}/${name}/collaborators`, '--paginate', '-q', '.[] | {login, avatar_url}'],
      { cwd: repoPath, maxBuffer: 5 * 1024 * 1024 }
    )
    return stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const c = JSON.parse(line) as { login: string; avatar_url?: string }
        return { login: c.login, avatarUrl: c.avatar_url }
      })
  } catch {
    return []
  }
}

// ── File blob (for diff context expansion) ─────────────────────────────────

export async function getPRFileBlob(
  repoPath: string,
  ref: string,
  filePath: string
): Promise<string | null> {
  try {
    const { owner, name } = await getRepoOwnerName(repoPath)
    const { stdout } = await execFileAsync(
      'gh',
      [
        'api',
        `repos/${owner}/${name}/contents/${filePath}?ref=${ref}`,
        '-H', 'Accept: application/vnd.github.raw',
      ],
      { cwd: repoPath, maxBuffer: 10 * 1024 * 1024 }
    )
    return stdout
  } catch {
    // Try local git as a fallback (works for branches checked out anywhere)
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['show', `${ref}:${filePath}`],
        { cwd: repoPath, maxBuffer: 10 * 1024 * 1024 }
      )
      return stdout
    } catch {
      return null
    }
  }
}

// ── Review threads: reply / resolve / unresolve ────────────────────────────

export async function replyToReviewThread(
  repoPath: string,
  prNumber: number,
  rootCommentId: number,
  body: string
): Promise<PRComment> {
  const { owner, name } = await getRepoOwnerName(repoPath)
  const { stdout } = await execFileAsync(
    'gh',
    [
      'api',
      `repos/${owner}/${name}/pulls/${prNumber}/comments`,
      '-f', `body=${body}`,
      '-F', `in_reply_to=${rootCommentId}`,
    ],
    { cwd: repoPath }
  )
  const c = JSON.parse(stdout) as {
    id: number
    body: string
    path: string
    line: number | null
    start_line?: number | null
    side: 'LEFT' | 'RIGHT'
    user: { login: string }
    created_at: string
    in_reply_to_id?: number | null
  }
  return {
    id: c.id,
    body: c.body,
    path: c.path,
    line: c.line,
    startLine: c.start_line ?? null,
    side: c.side || 'RIGHT',
    author: c.user.login,
    createdAt: c.created_at,
    inReplyToId: c.in_reply_to_id ?? rootCommentId,
  }
}

async function runThreadMutation(repoPath: string, threadId: string, mutation: 'resolve' | 'unresolve'): Promise<void> {
  const mutationName = mutation === 'resolve' ? 'resolveReviewThread' : 'unresolveReviewThread'
  const query = `mutation { ${mutationName}(input: {threadId: "${threadId}"}) { thread { id isResolved } } }`
  await execFileAsync(
    'gh',
    ['api', 'graphql', '-f', `query=${query}`],
    { cwd: repoPath }
  )
}

export async function resolveReviewThread(repoPath: string, threadId: string): Promise<void> {
  await runThreadMutation(repoPath, threadId, 'resolve')
}

export async function unresolveReviewThread(repoPath: string, threadId: string): Promise<void> {
  await runThreadMutation(repoPath, threadId, 'unresolve')
}

// ── Apply suggestion (write to local worktree + commit) ────────────────────

export interface ApplySuggestionResult {
  applied: boolean
  reason?: string
}

export async function applySuggestion(
  repoPath: string,
  filePath: string,
  startLine: number,
  endLine: number,
  newText: string,
  author: string
): Promise<ApplySuggestionResult> {
  const absPath = join(repoPath, filePath)
  let original: string
  try {
    original = await readFile(absPath, 'utf-8')
  } catch {
    return { applied: false, reason: 'File not found in worktree' }
  }
  const lines = original.split('\n')
  if (startLine < 1 || endLine > lines.length) {
    return { applied: false, reason: 'Line range is out of file bounds' }
  }
  const replacement = newText.split('\n')
  // Drop a trailing empty element if newText ended with \n (split produces "")
  if (replacement.length > 0 && replacement[replacement.length - 1] === '' && newText.endsWith('\n')) {
    replacement.pop()
  }
  const before = lines.slice(0, startLine - 1)
  const after = lines.slice(endLine)
  const next = [...before, ...replacement, ...after].join('\n')
  await writeFile(absPath, next, 'utf-8')
  // Stage + commit
  try {
    await execFileAsync('git', ['add', '--', filePath], { cwd: repoPath })
    await execFileAsync(
      'git',
      ['commit', '-m', `Apply suggestion from ${author}`, '--', filePath],
      { cwd: repoPath }
    )
  } catch (err) {
    return { applied: false, reason: err instanceof Error ? err.message : String(err) }
  }
  return { applied: true }
}
