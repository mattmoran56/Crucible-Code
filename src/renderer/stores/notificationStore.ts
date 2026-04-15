import { create } from 'zustand'
import type { SessionStatus, HookType } from '../../shared/types'

interface NotificationState {
  /** Map of sessionId → current status (undefined = idle/no indicator) */
  sessionStatuses: Map<string, SessionStatus>

  /** Map of sessionId → projectId (covers all projects, not just active) */
  sessionProjectMap: Map<string, string>

  /** Sessions that received a stop event while in attention state */
  stoppedWhileAttention: Set<string>

  /** Process a hook event and apply state transitions */
  handleHookEvent: (sessionId: string, hookType: HookType) => void

  /** Clear status for a session (e.g. when user clicks on it) */
  clearStatus: (sessionId: string) => void

  /** Register sessions so we can map sessionId → projectId across all projects */
  registerSessions: (sessions: Array<{ id: string; projectId: string }>) => void

  /** Get count of sessions needing user action for a given project (attention + completed) */
  getNotificationCountForProject: (projectId: string) => number
}

function getNotificationCount(statuses: Map<string, SessionStatus>, projectMap: Map<string, string>, projectId?: string): number {
  let count = 0
  for (const [sessionId, status] of statuses) {
    if (status === 'attention' || status === 'completed') {
      if (!projectId || projectMap.get(sessionId) === projectId) count++
    }
  }
  return count
}

function syncBadgeCount(statuses: Map<string, SessionStatus>, projectMap: Map<string, string>) {
  const count = getNotificationCount(statuses, projectMap)
  window.api.notification.setBadge(count)
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  sessionStatuses: new Map(),
  sessionProjectMap: new Map(),
  stoppedWhileAttention: new Set(),

  handleHookEvent: (sessionId: string, hookType: HookType) => {
    set((state) => {
      const current = state.sessionStatuses.get(sessionId)

      let next: SessionStatus
      const nextStopped = new Set(state.stoppedWhileAttention)
      switch (hookType) {
        case 'prompt':
          // Short-circuit: if already running, no state change needed
          if (current === 'running') return state
          // New prompt means Claude is working again — clear any stale stop flag
          nextStopped.delete(sessionId)
          next = 'running'
          break
        case 'notification':
          next = 'attention'
          break
        case 'stop':
          if (current === 'attention') {
            // Claude stopped while we're showing attention — record it so
            // clearStatus transitions to completed instead of back to running.
            nextStopped.add(sessionId)
            return { stoppedWhileAttention: nextStopped }
          }
          nextStopped.delete(sessionId)
          next = 'completed'
          break
      }

      const nextStatuses = new Map(state.sessionStatuses)
      nextStatuses.set(sessionId, next)
      syncBadgeCount(nextStatuses, state.sessionProjectMap)
      return { sessionStatuses: nextStatuses, stoppedWhileAttention: nextStopped }
    })
  },

  clearStatus: (sessionId: string) => {
    set((state) => {
      const current = state.sessionStatuses.get(sessionId)
      if (!current) return state

      const next = new Map(state.sessionStatuses)
      const nextStopped = new Set(state.stoppedWhileAttention)

      if (current === 'attention') {
        if (state.stoppedWhileAttention.has(sessionId)) {
          // Stop already arrived — task is done, clear everything
          next.delete(sessionId)
          nextStopped.delete(sessionId)
        } else {
          // Process is still running — restore spinner
          next.set(sessionId, 'running')
        }
      } else if (current === 'completed') {
        next.delete(sessionId)
        nextStopped.delete(sessionId)
      } else {
        // 'running' — never clear the spinner via user interaction
        return state
      }

      syncBadgeCount(next, state.sessionProjectMap)
      return { sessionStatuses: next, stoppedWhileAttention: nextStopped }
    })
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
    const { sessionStatuses, sessionProjectMap } = get()
    return getNotificationCount(sessionStatuses, sessionProjectMap, projectId)
  },
}))
