import type { PullRequest, Session } from './types'

/**
 * The pull request that belongs to a session.
 *
 * A PR assigned by hand (or by an agent through the `crucible` MCP server's
 * assign_pr tool) wins: that is how a repo-root session — which has no branch
 * of its own to match on — gets a PR. Otherwise a worktree session's PR is the
 * one whose head branch is the session's branch.
 */
export function sessionPullRequest(
  session: Pick<Session, 'branchName' | 'prNumber' | 'repoRoot'> | null | undefined,
  pullRequests: PullRequest[]
): PullRequest | undefined {
  if (!session) return undefined
  if (session.prNumber != null) {
    const assigned = pullRequests.find((pr) => pr.number === session.prNumber)
    if (assigned) return assigned
  }
  if (session.repoRoot || !session.branchName) return undefined
  return pullRequests.find((pr) => pr.headRefName === session.branchName)
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
