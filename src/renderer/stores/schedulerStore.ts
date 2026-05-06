import { create } from 'zustand'
import type { QueuedSession, QueuedMessage } from '../../shared/types'

interface SchedulerState {
  queuedSessions: QueuedSession[]
  queuedMessages: QueuedMessage[]
  loaded: boolean

  load: () => Promise<void>
  setQueuedSessions: (list: QueuedSession[]) => void
  setQueuedMessages: (list: QueuedMessage[]) => void

  addQueuedSession: (item: QueuedSession) => Promise<void>
  cancelQueuedSession: (id: string) => Promise<void>
  rescheduleQueuedSession: (id: string, scheduledFor: number) => Promise<void>
  fireQueuedSessionNow: (id: string) => Promise<void>

  addQueuedMessage: (item: QueuedMessage) => Promise<void>
  cancelQueuedMessage: (id: string) => Promise<void>

  getQueuedMessageForSession: (sessionId: string) => QueuedMessage | undefined
}

export const useSchedulerStore = create<SchedulerState>((set, get) => ({
  queuedSessions: [],
  queuedMessages: [],
  loaded: false,

  load: async () => {
    const [queuedSessions, queuedMessages] = await Promise.all([
      window.api.scheduler.listQueuedSessions(),
      window.api.scheduler.listQueuedMessages(),
    ])
    set({ queuedSessions, queuedMessages, loaded: true })
  },

  setQueuedSessions: (list) => set({ queuedSessions: list }),
  setQueuedMessages: (list) => set({ queuedMessages: list }),

  addQueuedSession: async (item) => {
    const list = await window.api.scheduler.addQueuedSession(item)
    set({ queuedSessions: list })
  },
  cancelQueuedSession: async (id) => {
    const list = await window.api.scheduler.cancelQueuedSession(id)
    set({ queuedSessions: list })
  },
  rescheduleQueuedSession: async (id, scheduledFor) => {
    const list = await window.api.scheduler.rescheduleQueuedSession(id, scheduledFor)
    set({ queuedSessions: list })
  },
  fireQueuedSessionNow: async (id) => {
    await window.api.scheduler.fireQueuedSessionNow(id)
    // Main process broadcasts the new list via SCHEDULER_QUEUED_SESSIONS_UPDATE,
    // so we don't need to update locally here.
  },

  addQueuedMessage: async (item) => {
    const list = await window.api.scheduler.addQueuedMessage(item)
    set({ queuedMessages: list })
  },
  cancelQueuedMessage: async (id) => {
    const list = await window.api.scheduler.cancelQueuedMessage(id)
    set({ queuedMessages: list })
  },

  getQueuedMessageForSession: (sessionId) =>
    get().queuedMessages.find((m) => m.sessionId === sessionId),
}))
