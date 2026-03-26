import { create } from 'zustand'
import type { SessionUsage, UsageStats, SubscriptionInfo } from '../../shared/types'
import { useToastStore } from './toastStore'

interface UsageState {
  /** Usage data keyed by sessionId */
  sessionUsages: Record<string, SessionUsage>
  stats: UsageStats | null
  subscription: SubscriptionInfo | null
  statsLoading: boolean

  updateSessionUsage: (usage: SessionUsage) => void
  fetchSessionUsage: (sessionId: string) => Promise<void>
  fetchStats: () => Promise<void>
  fetchSubscription: () => Promise<void>
}

export const useUsageStore = create<UsageState>((set, get) => ({
  sessionUsages: {},
  stats: null,
  subscription: null,
  statsLoading: false,

  updateSessionUsage: (usage) => {
    set((state) => ({
      sessionUsages: { ...state.sessionUsages, [usage.sessionId]: usage },
    }))
  },

  fetchSessionUsage: async (sessionId) => {
    try {
      const usage = await window.api.usage.getSession(sessionId)
      if (usage) {
        get().updateSessionUsage(usage)
      }
    } catch (err) {
      useToastStore.getState().addToast('error', err instanceof Error ? err.message : String(err))
    }
  },

  fetchStats: async () => {
    set({ statsLoading: true })
    try {
      const stats = await window.api.usage.getStats()
      set({ stats, statsLoading: false })
    } catch (err) {
      set({ statsLoading: false })
      useToastStore.getState().addToast('error', err instanceof Error ? err.message : String(err))
    }
  },

  fetchSubscription: async () => {
    try {
      const subscription = await window.api.usage.getSubscription()
      set({ subscription })
    } catch (err) {
      useToastStore.getState().addToast('error', err instanceof Error ? err.message : String(err))
    }
  },
}))
