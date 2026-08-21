/**
 * Main-process view of "which sessions are waiting on someone".
 *
 * The renderer already derives this in `notificationStore`, but that state
 * lives behind the window — a main-process agent (and the remote receiver)
 * can't see it. This service subscribes to the same hook events and keeps an
 * authoritative copy in main, using the shared reducer in `shared/overseer.ts`
 * so the two can't drift apart on the transition rules.
 *
 * It intentionally does NOT replace the renderer store: that one also carries
 * UI concerns (auto-clear on navigate, badge sync) which don't belong here.
 */
import type { HookType, SessionStatus } from '../../shared/types'
import { nextSessionStatus, rollupStatus } from '../../shared/overseer'
import { onHookEvent } from './notification-server'

/** contextId → tabId → status */
const contextStatuses = new Map<string, Map<string, SessionStatus>>()
/** contextId → tabId → epoch ms of the last hook event */
const lastEventAt = new Map<string, number>()

let unsubscribe: (() => void) | null = null

export function installSessionStatusTracking(): void {
  if (unsubscribe) return
  unsubscribe = onHookEvent(({ contextId, tabId, hookType }) => {
    recordHookEvent(contextId, tabId, hookType)
  })
}

export function stopSessionStatusTracking(): void {
  unsubscribe?.()
  unsubscribe = null
  contextStatuses.clear()
  lastEventAt.clear()
}

/** Exported for tests — applies one hook event to the in-memory map. */
export function recordHookEvent(contextId: string, tabId: string, hookType: HookType): void {
  const tabs = contextStatuses.get(contextId) ?? new Map<string, SessionStatus>()
  const next = nextSessionStatus(tabs.get(tabId), hookType)
  lastEventAt.set(contextId, Date.now())
  if (next === null) return
  tabs.set(tabId, next)
  contextStatuses.set(contextId, tabs)
}

/** Rolled-up status for a context (worst of any tab), or undefined if unseen. */
export function getSessionStatus(contextId: string): SessionStatus | undefined {
  const tabs = contextStatuses.get(contextId)
  if (!tabs) return undefined
  return rollupStatus(tabs.values())
}

/** Epoch ms of the last hook event for a context. */
export function getLastEventAt(contextId: string): number | undefined {
  return lastEventAt.get(contextId)
}

/**
 * Clear a context's tracked status — called when the user opens the session,
 * mirroring the renderer's auto-clear so the Overseer doesn't keep reporting
 * something already dealt with.
 */
export function clearSessionStatus(contextId: string): void {
  contextStatuses.delete(contextId)
}

/** All tracked contexts and their rolled-up status. Used by the Overseer snapshot. */
export function allSessionStatuses(): Map<string, SessionStatus> {
  const out = new Map<string, SessionStatus>()
  for (const [contextId, tabs] of contextStatuses) {
    const status = rollupStatus(tabs.values())
    if (status) out.set(contextId, status)
  }
  return out
}
