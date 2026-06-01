import { useSyncExternalStore } from 'react'
import { IPC } from '@protocol/channels'
import { wsClient } from './wsClient'

export type SessionStatus = 'running' | 'attention' | 'completed'

// contextId → tabId → status. The desktop emits status per tab; the sidebar
// dot shows the worst-of-any-tab rollup so a single Claude tab in 'attention'
// surfaces on the parent session row.
type TabMap = Map<string, SessionStatus>
const state = new Map<string, TabMap>()
const subscribers = new Set<() => void>()
let initialised = false

function notify(): void {
  for (const s of subscribers) s()
}

function rollup(tabs: TabMap | undefined): SessionStatus | null {
  if (!tabs || tabs.size === 0) return null
  let hasCompleted = false
  let hasRunning = false
  for (const status of tabs.values()) {
    if (status === 'attention') return 'attention'
    if (status === 'completed') hasCompleted = true
    else if (status === 'running') hasRunning = true
  }
  if (hasCompleted) return 'completed'
  if (hasRunning) return 'running'
  return null
}

function hookToStatus(hookType: string, current: SessionStatus | undefined): SessionStatus | null {
  switch (hookType) {
    case 'prompt':
      return 'running'
    case 'notification':
      return 'attention'
    case 'stop':
      // Mirror desktop semantics: if a tab was in attention, don't downgrade
      // it just because the agent later stopped — the user still needs to act.
      if (current === 'attention') return 'attention'
      return 'completed'
    default:
      return null
  }
}

export function initSessionStatus(): void {
  if (initialised) return
  initialised = true

  wsClient.on(IPC.NOTIFICATION_SESSION_STATUS, (...args: unknown[]) => {
    const [contextId, tabId, hookType] = args as [string, string, string]
    if (!contextId || !tabId) return
    const tabs = state.get(contextId) ?? new Map<string, SessionStatus>()
    const next = hookToStatus(hookType, tabs.get(tabId))
    if (!next) return
    const nextTabs = new Map(tabs)
    nextTabs.set(tabId, next)
    state.set(contextId, nextTabs)
    notify()
  })
}

function subscribe(cb: () => void): () => void {
  subscribers.add(cb)
  return () => subscribers.delete(cb)
}

export function useContextStatus(contextId: string): SessionStatus | null {
  return useSyncExternalStore(
    subscribe,
    () => rollup(state.get(contextId)),
    () => null,
  )
}

/** Clear status for a context — call when the user navigates into the session. */
export function clearContextStatus(contextId: string): void {
  if (!state.has(contextId)) return
  state.delete(contextId)
  notify()
}

/**
 * Worst-of-all rollup across every known context. Used by the hamburger
 * badge so the closed drawer still signals "something needs you" / "running".
 */
function globalRollup(): SessionStatus | null {
  let hasCompleted = false
  let hasRunning = false
  for (const tabs of state.values()) {
    const r = rollup(tabs)
    if (r === 'attention') return 'attention'
    if (r === 'completed') hasCompleted = true
    else if (r === 'running') hasRunning = true
  }
  if (hasCompleted) return 'completed'
  if (hasRunning) return 'running'
  return null
}

export function useGlobalStatus(): SessionStatus | null {
  return useSyncExternalStore(subscribe, globalRollup, () => null)
}
