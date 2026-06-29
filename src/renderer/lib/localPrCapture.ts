import type { LocalPR, Session } from '../../shared/types'

/**
 * Reconcile gh-shim capture against local-PR state. A session keeps the gh shim
 * on its terminal PATH while **Capture PRs locally** is on; once that session's
 * local PR is promoted to a real GitHub PR (it has a `realPrNumber`), the shim
 * must be dropped so the agent's later `gh` commands act on the real PR instead
 * of being captured into a fresh local one.
 *
 * Returns the sessions whose capture flag should be cleared: capture is still
 * on *and* at least one of their local PRs has been promoted. Pure — the sidebar
 * effect dispatches the actual flag clear, so this stays trivially unit-testable.
 *
 * Idempotent: a session already off (or with only un-promoted local PRs) is
 * never returned, so re-running after the flag is cleared yields an empty list.
 */
export function sessionsToDropCapture(
  localPRs: readonly LocalPR[],
  sessions: readonly Session[]
): Session[] {
  // Sessions that own a promoted local PR. `realPrNumber` is the durable signal
  // that the record is now a real PR (set on a successful promote); status alone
  // is racy (`promoting` is transient and merge can happen out of band).
  const promotedSessionIds = new Set<string>()
  for (const lpr of localPRs) {
    if (lpr.sessionId && lpr.realPrNumber != null) promotedSessionIds.add(lpr.sessionId)
  }
  if (promotedSessionIds.size === 0) return []

  return sessions.filter(
    (s) => s.captureLocalPr === true && promotedSessionIds.has(s.id)
  )
}
