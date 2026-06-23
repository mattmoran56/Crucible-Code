import { execFile } from 'child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'util'
import type { PullRequest, PRFile, PRComment, PRReviewEvent, PRMergeMethod, PRDetail, PRConversationComment, PRCheck, Commit, PRReviewThread, PRReviewState, PRReviewSummary, GitHubCollaborator, PRLabel } from '../../shared/types'
import { deriveCIStatus } from '../../shared/ci'

const execFileAsync = promisify(execFile)

// ── Foundry helpers ────────────────────────────────────────────────────────

const PR_NUMBER_RE = /\/pull\/(\d+)\s*$/

export interface FoundryPRInfo {
  number: number
  url: string
  isDraft?: boolean
}

/**
 * Create a draft PR. If one already exists for the head branch, returns the
 * existing PR instead of throwing — keeping the call idempotent for retries.
 */
export async function createDraftPR(
  worktreePath: string,
  opts: { title: string; body: string; base: string; head: string }
): Promise<FoundryPRInfo> {
  try {
    const { stdout } = await execFileAsync(
      'gh',
      ['pr', 'create', '--draft', '--title', opts.title, '--body', opts.body, '--base', opts.base, '--head', opts.head],
      { cwd: worktreePath, maxBuffer: 5 * 1024 * 1024 }
    )
    const url = stdout.trim().split('\n').pop() ?? ''
    const m = url.match(PR_NUMBER_RE)
    if (!m) throw new Error(`Unparseable gh pr create output: ${stdout}`)
    return { number: Number(m[1]), url, isDraft: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/already exists/i.test(msg)) {
      const existing = await findPRForBranch(worktreePath, opts.head)
      if (existing) return existing
    }
    throw err
  }
}

export async function findPRForBranch(
  worktreePath: string,
  branch: string
): Promise<FoundryPRInfo | null> {
  try {
    const { stdout } = await execFileAsync(
      'gh',
      ['pr', 'list', '--head', branch, '--state', 'open', '--json', 'number,url,isDraft'],
      { cwd: worktreePath }
    )
    const arr = JSON.parse(stdout) as Array<{ number: number; url: string; isDraft: boolean }>
    if (arr.length === 0) return null
    const first = arr[0]
    return { number: first.number, url: first.url, isDraft: first.isDraft }
  } catch {
    return null
  }
}

/** Flip a draft PR to ready-for-review. Idempotent: swallows "already ready". */
export async function markPRReady(worktreePath: string, prNumber: number): Promise<void> {
  try {
    await execFileAsync('gh', ['pr', 'ready', String(prNumber)], { cwd: worktreePath })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/already ready/i.test(msg) || /is not in draft/i.test(msg)) return
    throw err
  }
}

export async function getCurrentGitHubUser(repoPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      'gh',
      ['api', 'user', '--jq', '.login'],
      { cwd: repoPath }
    )
    const login = stdout.trim()
    return login || null
  } catch {
    return null
  }
}

async function getRepoOwnerName(repoPath: string): Promise<{ owner: string; name: string }> {
  const { stdout } = await execFileAsync(
    'gh',
    ['repo', 'view', '--json', 'owner,name'],
    { cwd: repoPath }
  )
  const parsed = JSON.parse(stdout) as { owner: { login: string }; name: string }
  return { owner: parsed.owner.login, name: parsed.name }
}

function summarizeLatestReviews(
  latestReviews: Array<{ author: { login: string }; state: string; submittedAt: string }> | null | undefined,
  reviews: Array<{ author: { login: string }; state: string; submittedAt: string }> | null | undefined
): PRReviewSummary[] {
  if (latestReviews && latestReviews.length > 0) {
    return latestReviews.map((r) => ({
      author: r.author.login,
      state: r.state.toUpperCase() as PRReviewState,
      submittedAt: r.submittedAt,
    }))
  }
  if (reviews && reviews.length > 0) {
    const byAuthor = new Map<string, PRReviewSummary>()
    const sorted = [...reviews].sort((a, b) =>
      a.submittedAt.localeCompare(b.submittedAt)
    )
    for (const r of sorted) {
      byAuthor.set(r.author.login, {
        author: r.author.login,
        state: r.state.toUpperCase() as PRReviewState,
        submittedAt: r.submittedAt,
      })
    }
    return [...byAuthor.values()]
  }
  return []
}

export async function listOpenPRs(repoPath: string): Promise<PullRequest[]> {
  const fields = 'number,title,headRefName,baseRefName,author,assignees,reviewRequests,createdAt,updatedAt,isDraft,state,statusCheckRollup,labels,latestReviews,comments'

  async function fetchPRs(state: string): Promise<PullRequest[]> {
    try {
      const { stdout } = await execFileAsync(
        'gh',
        ['pr', 'list', '--state', state, '--json', fields, '--limit', '50'],
        { cwd: repoPath, maxBuffer: 10 * 1024 * 1024 }
      )

      const raw = JSON.parse(stdout) as Array<{
        number: number
        title: string
        headRefName: string
        baseRefName: string
        author: { login: string }
        assignees?: Array<{ login: string }>
        reviewRequests?: Array<{ login?: string; name?: string }>
        createdAt: string
        updatedAt: string
        isDraft: boolean
        state: string
        statusCheckRollup?: Array<{ status?: string | null; conclusion?: string | null }> | null
        labels?: Array<{ name: string; color: string; description?: string }>
        latestReviews?: Array<{ author: { login: string }; state: string; submittedAt: string }>
        comments?: Array<unknown>
      }>

      return raw.map((pr) => ({
        number: pr.number,
        title: pr.title,
        headRefName: pr.headRefName,
        baseRefName: pr.baseRefName,
        author: pr.author.login,
        assignees: (pr.assignees || []).map((a) => a.login).filter(Boolean),
        requestedReviewers: (pr.reviewRequests || [])
          .map((r) => r.login || r.name || '')
          .filter(Boolean),
        createdAt: pr.createdAt,
        updatedAt: pr.updatedAt,
        isDraft: pr.isDraft,
        state: pr.state === 'MERGED' ? 'MERGED' as const : 'OPEN' as const,
        ciStatus: deriveCIStatus(pr.statusCheckRollup),
        labels: (pr.labels || []).map((l) => ({
          name: l.name,
          color: l.color,
          description: l.description,
        })),
        commentsCount: (pr.comments || []).length,
        reviews: summarizeLatestReviews(pr.latestReviews, undefined),
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

export async function listRepoLabels(repoPath: string): Promise<PRLabel[]> {
  try {
    const { owner, name } = await getRepoOwnerName(repoPath)
    const { stdout } = await execFileAsync(
      'gh',
      [
        'api',
        `repos/${owner}/${name}/labels`,
        '--paginate',
        '-q',
        '.[] | {name, color, description}',
      ],
      { cwd: repoPath, maxBuffer: 5 * 1024 * 1024 }
    )
    return stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const l = JSON.parse(line) as { name: string; color: string; description?: string | null }
        return {
          name: l.name,
          color: l.color,
          description: l.description ?? undefined,
        }
      })
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

  const reviews = summarizeLatestReviews(data.latestReviews, data.reviews)

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
