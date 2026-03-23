import { create } from 'zustand'

interface NotificationState {
  /** Set of session IDs that have pending attention notifications */
  pendingSessionIds: Set<string>

  /** Add a session to the pending set */
  addPending: (sessionId: string) => void

  /** Clear a session's pending notification (e.g. when user clicks on it) */
  clearPending: (sessionId: string) => void

  /** Get count of pending notifications for a given project */
  getPendingCountForProject: (
    sessions: Array<{ id: string; projectId: string }>
  ) => (projectId: string) => number
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  pendingSessionIds: new Set(),

  addPending: (sessionId: string) => {
    set((state) => {
      const next = new Set(state.pendingSessionIds)
      next.add(sessionId)
      return { pendingSessionIds: next }
    })
  },

  clearPending: (sessionId: string) => {
    set((state) => {
      if (!state.pendingSessionIds.has(sessionId)) return state
      const next = new Set(state.pendingSessionIds)
      next.delete(sessionId)
      return { pendingSessionIds: next }
    })
  },

  getPendingCountForProject:
    (sessions) =>
    (projectId: string): number => {
      const pending = get().pendingSessionIds
      return sessions.filter((s) => s.projectId === projectId && pending.has(s.id)).length
    },
}))
