import type { CIStatus } from './types'

/**
 * Collapse a GitHub `statusCheckRollup` (or any list of check-like entries) into
 * a single CI status for the PR card / review panel.
 */
export function deriveCIStatus(
  rollup: Array<{ status?: string | null; conclusion?: string | null }> | null | undefined
): CIStatus {
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
