import { create } from 'zustand'
import type { SessionUsage, UsageStats, SubscriptionInfo } from '../../shared/types'
import { useToastStore } from './toastStore'
import { useProjectStore } from './projectStore'

function getActiveConfigDir(): string | undefined {
  const { projects, activeProjectId, claudeAccounts } = useProjectStore.getState()
  const project = projects.find((p) => p.id === activeProjectId)
  if (!project?.claudeAccountId) return undefined
  const account = claudeAccounts.find((a) => a.id === project.claudeAccountId)
  return account?.configDir
}

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
      const configDir = getActiveConfigDir()
      const stats = await window.api.usage.getStats(configDir)
      set({ stats, statsLoading: false })
    } catch (err) {
      set({ statsLoading: false })
      useToastStore.getState().addToast('error', err instanceof Error ? err.message : String(err))
    }
  },

  fetchSubscription: async () => {
    try {
      const configDir = getActiveConfigDir()
      const subscription = await window.api.usage.getSubscription(configDir)
      set({ subscription })
    } catch (err) {
      useToastStore.getState().addToast('error', err instanceof Error ? err.message : String(err))
    }
  },
}))
