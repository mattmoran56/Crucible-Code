import type { FoundryConfig } from './types'

/** The optimistic status assumed when the toggle is on but no list is configured. */
export const DEFAULT_OPTIMISTIC_STATUSES = ['In review'] as const

/**
 * The statuses that count as "optimistically satisfied but not yet on trunk"
 * for a given foundry config. Returns an empty list when optimistic continue is
 * off (so callers never merge branches or treat in-review deps as ready), and
 * the configured list — or the `In review` default — when it's on.
 *
 * Shared by the foreman context builder and the snapshot-diff watcher so the
 * two can never drift on what "optimistic" means.
 */
export function resolveOptimisticStatuses(
  cfg: Pick<FoundryConfig, 'optimisticContinue' | 'optimisticStatuses'>
): string[] {
  if (!cfg.optimisticContinue) return []
  return cfg.optimisticStatuses ?? [...DEFAULT_OPTIMISTIC_STATUSES]
}
