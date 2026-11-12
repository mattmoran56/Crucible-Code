import type { PullRequest, Session } from './types'

const CLOUD_SESSION_LINK = /claude\.ai\/code\/(session_[A-Za-z0-9]+)/g

/** The cloud session ids a PR description links to (`claude.ai/code/session_...`), deduplicated. */
export function cloudSessionIdsIn(text: string | null | undefined): string[] {
  if (!text) return []
  return [...new Set([...text.matchAll(CLOUD_SESSION_LINK)].map((m) => m[1]))]
}

/**
 * The pull request that belongs to a session.
 *
 * A PR assigned by hand (or by an agent through the `crucible` MCP server's
 * assign_pr tool) wins: that is how a repo-root session — which has no branch
 * of its own to match on — gets a PR. Otherwise a worktree session's PR is the
 * one whose head branch is the session's branch.
 *
 * A cloud session may open its PR from another branch (the cloud agent can
 * push to a `claude/...` branch of its own), so it also matches on the branch
 * the cloud agent was told to use and, failing that, on a PR whose
 * description links to its cloud session.
 */
export function sessionPullRequest(
  session: Pick<Session, 'branchName' | 'prNumber' | 'repoRoot' | 'cloud'> | null | undefined,
  pullRequests: PullRequest[]
): PullRequest | undefined {
  if (!session) return undefined
  if (session.prNumber != null) {
    const assigned = pullRequests.find((pr) => pr.number === session.prNumber)
    if (assigned) return assigned
  }
  if (session.repoRoot) return undefined
  if (session.branchName) {
    const byBranch = pullRequests.find((pr) => pr.headRefName === session.branchName)
    if (byBranch) return byBranch
  }
  const cloud = session.cloud
  if (!cloud) return undefined
  if (cloud.branch) {
    const byCloudBranch = pullRequests.find((pr) => pr.headRefName === cloud.branch)
    if (byCloudBranch) return byCloudBranch
  }
  return pullRequests.find((pr) => pr.cloudSessionIds?.includes(cloud.sessionId))
}

/** Whether a PR can be assigned to this session by hand: only a repo-root (no worktree) session. */
export function canAssignSessionPR(session: Pick<Session, 'repoRoot'>): boolean {
  return !!session.repoRoot
}

/** `session` with `prNumber` assigned, or with no PR assigned for `null`. */
export function withAssignedPR<T extends Session>(session: T, prNumber: number | null): T {
  if (prNumber == null) {
    const { prNumber: _dropped, ...rest } = session
    return rest as T
  }
  return { ...session, prNumber }
}
