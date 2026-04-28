import { create } from 'zustand'
import type { SessionStatus, HookType } from '../../shared/types'

/**
 * Status is tracked per (contextId, tabId). A "context" is a session, the per-project
 * Code editor, or a PR sidebar item. The session/context-level indicator is the
 * roll-up of every tab's status under that context.
 */
type TabStatusMap = Map<string, SessionStatus>

interface NotificationState {
  /** Map of contextId → (tabId → status) */
  contextStatuses: Map<string, TabStatusMap>

  /** Map of contextId → projectId (covers all projects, not just active) */
  sessionProjectMap: Map<string, string>

  /** (contextId|tabId) keys whose tab received a stop event while in attention state */
  stoppedWhileAttention: Set<string>

  /** Process a hook event and apply state transitions */
  handleHookEvent: (contextId: string, tabId: string, hookType: HookType) => void

  /** Clear status for a single tab in a context */
  clearTabStatus: (contextId: string, tabId: string) => void

  /** Clear all tab statuses in a context (used when user clicks the context's sidebar item) */
  clearContextStatuses: (contextId: string) => void

  /** Get rolled-up status for a context (worst of any tab: attention > completed > running) */
  getContextStatus: (contextId: string) => SessionStatus | null

  /** Get raw status for a single tab */
  getTabStatus: (contextId: string, tabId: string) => SessionStatus | null

  /** Register sessions so we can map sessionId → projectId across all projects */
  registerSessions: (sessions: Array<{ id: string; projectId: string }>) => void

  /** Get count of contexts in the given project that need user action (attention + completed) */
  getNotificationCountForProject: (projectId: string) => number
}

function rollupStatus(tabs: TabStatusMap | undefined): SessionStatus | null {
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

function getNotificationCount(
  contextStatuses: Map<string, TabStatusMap>,
  projectMap: Map<string, string>,
  projectId?: string
): number {
  let count = 0
  for (const [contextId, tabs] of contextStatuses) {
    const status = rollupStatus(tabs)
    if (status === 'attention' || status === 'completed') {
      if (!projectId || projectMap.get(contextId) === projectId) count++
    }
  }
  return count
}

function syncBadgeCount(
  contextStatuses: Map<string, TabStatusMap>,
  projectMap: Map<string, string>
) {
  const count = getNotificationCount(contextStatuses, projectMap)
  window.api.notification.setBadge(count)
}

function cloneContextStatuses(
  src: Map<string, TabStatusMap>
): Map<string, TabStatusMap> {
  const next = new Map<string, TabStatusMap>()
  for (const [k, v] of src) next.set(k, new Map(v))
  return next
}

const stopKey = (contextId: string, tabId: string) => `${contextId}|${tabId}`

export const useNotificationStore = create<NotificationState>((set, get) => ({
  contextStatuses: new Map(),
  sessionProjectMap: new Map(),
  stoppedWhileAttention: new Set(),

  handleHookEvent: (contextId: string, tabId: string, hookType: HookType) => {
    set((state) => {
      const tabs = state.contextStatuses.get(contextId) ?? new Map<string, SessionStatus>()
      const current = tabs.get(tabId)
      const key = stopKey(contextId, tabId)

      const nextStopped = new Set(state.stoppedWhileAttention)
      let next: SessionStatus
      switch (hookType) {
        case 'prompt':
          if (current === 'running') return state
          nextStopped.delete(key)
          next = 'running'
          break
        case 'notification':
          next = 'attention'
          break
        case 'stop':
          if (current === 'attention') {
            // Defer the transition to 'completed' until the user has cleared
            // the attention state — otherwise we'd lose the visual cue that
            // they had to act on something.
            nextStopped.add(key)
            return { stoppedWhileAttention: nextStopped }
          }
          nextStopped.delete(key)
          next = 'completed'
          break
      }

      const nextContextStatuses = cloneContextStatuses(state.contextStatuses)
      const nextTabs = new Map(tabs)
      nextTabs.set(tabId, next)
      nextContextStatuses.set(contextId, nextTabs)
      syncBadgeCount(nextContextStatuses, state.sessionProjectMap)
      return {
        contextStatuses: nextContextStatuses,
        stoppedWhileAttention: nextStopped,
      }
    })
  },

  clearTabStatus: (contextId: string, tabId: string) => {
    set((state) => {
      const tabs = state.contextStatuses.get(contextId)
      if (!tabs) return state
      const current = tabs.get(tabId)
      if (!current) return state

      const key = stopKey(contextId, tabId)
      const nextStopped = new Set(state.stoppedWhileAttention)
      const nextContextStatuses = cloneContextStatuses(state.contextStatuses)
      const nextTabs = nextContextStatuses.get(contextId)!

      if (current === 'attention') {
        if (state.stoppedWhileAttention.has(key)) {
          nextTabs.delete(tabId)
          nextStopped.delete(key)
        } else {
          nextTabs.set(tabId, 'running')
        }
      } else if (current === 'completed') {
        nextTabs.delete(tabId)
        nextStopped.delete(key)
      } else {
        // 'running' — never clear via user interaction
        return state
      }

      if (nextTabs.size === 0) nextContextStatuses.delete(contextId)
      syncBadgeCount(nextContextStatuses, state.sessionProjectMap)
      return {
        contextStatuses: nextContextStatuses,
        stoppedWhileAttention: nextStopped,
      }
    })
  },

  clearContextStatuses: (contextId: string) => {
    set((state) => {
      const tabs = state.contextStatuses.get(contextId)
      if (!tabs) return state

      const nextStopped = new Set(state.stoppedWhileAttention)
      const nextContextStatuses = cloneContextStatuses(state.contextStatuses)
      const nextTabs = nextContextStatuses.get(contextId)!

      for (const [tabId, status] of tabs) {
        const key = stopKey(contextId, tabId)
        if (status === 'attention') {
          if (state.stoppedWhileAttention.has(key)) {
            nextTabs.delete(tabId)
            nextStopped.delete(key)
          } else {
            nextTabs.set(tabId, 'running')
          }
        } else if (status === 'completed') {
          nextTabs.delete(tabId)
          nextStopped.delete(key)
        }
        // running: leave alone
      }

      if (nextTabs.size === 0) nextContextStatuses.delete(contextId)
      syncBadgeCount(nextContextStatuses, state.sessionProjectMap)
      return {
        contextStatuses: nextContextStatuses,
        stoppedWhileAttention: nextStopped,
      }
    })
  },

  getContextStatus: (contextId: string) => {
    return rollupStatus(get().contextStatuses.get(contextId))
  },

  getTabStatus: (contextId: string, tabId: string) => {
    return get().contextStatuses.get(contextId)?.get(tabId) ?? null
  },

  registerSessions: (sessions) => {
    set((state) => {
      const next = new Map(state.sessionProjectMap)
      for (const s of sessions) {
        next.set(s.id, s.projectId)
      }
      return { sessionProjectMap: next }
    })
  },

  getNotificationCountForProject: (projectId: string): number => {
    const { contextStatuses, sessionProjectMap } = get()
    return getNotificationCount(contextStatuses, sessionProjectMap, projectId)
  },
}))
