import { create } from 'zustand'

interface NotificationState {
  /** Set of session IDs that have pending attention notifications */
  pendingSessionIds: Set<string>

  /** Map of sessionId → projectId (covers all projects, not just active) */
  sessionProjectMap: Map<string, string>

  /** Add a session to the pending set */
  addPending: (sessionId: string) => void

  /** Clear a session's pending notification (e.g. when user clicks on it) */
  clearPending: (sessionId: string) => void

  /** Register sessions so we can map sessionId → projectId across all projects */
  registerSessions: (sessions: Array<{ id: string; projectId: string }>) => void

  /** Get count of pending notifications for a given project */
  getPendingCountForProject: (projectId: string) => number
}

function syncBadgeCount(pendingCount: number) {
  window.api.notification.setBadge(pendingCount)
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  pendingSessionIds: new Set(),
  sessionProjectMap: new Map(),

  addPending: (sessionId: string) => {
    set((state) => {
      const next = new Set(state.pendingSessionIds)
      next.add(sessionId)
      syncBadgeCount(next.size)
      return { pendingSessionIds: next }
    })
  },

  clearPending: (sessionId: string) => {
    set((state) => {
      if (!state.pendingSessionIds.has(sessionId)) return state
      const next = new Set(state.pendingSessionIds)
      next.delete(sessionId)
      syncBadgeCount(next.size)
      return { pendingSessionIds: next }
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

  getPendingCountForProject: (projectId: string): number => {
    const { pendingSessionIds, sessionProjectMap } = get()
    let count = 0
    for (const sessionId of pendingSessionIds) {
      if (sessionProjectMap.get(sessionId) === projectId) count++
    }
    return count
  },
}))
