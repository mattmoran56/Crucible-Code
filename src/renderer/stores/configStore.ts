import { create } from 'zustand'
import type { ConfigItem, ConfigTrackingMode } from '../../shared/types'
import { useToastStore } from './toastStore'

interface ConfigState {
  items: ConfigItem[]
  loading: boolean
  loadItems: (repoPath: string) => Promise<void>
  setTracking: (repoPath: string, itemId: string, mode: ConfigTrackingMode) => Promise<void>
  createCommand: (repoPath: string, name: string, content: string) => Promise<void>
  createClaudeMd: (repoPath: string, location: 'root' | '.claude', content: string) => Promise<void>
  deleteItem: (repoPath: string, itemId: string) => Promise<void>
  updateItems: (items: ConfigItem[]) => void
}

export const useConfigStore = create<ConfigState>((set, get) => ({
  items: [],
  loading: false,

  loadItems: async (repoPath) => {
    set({ loading: true })
    try {
      const items = await window.api.config.list(repoPath)
      set({ items, loading: false })
    } catch (err) {
      set({ loading: false })
      useToastStore.getState().addToast('error', err instanceof Error ? err.message : String(err))
    }
  },

  setTracking: async (repoPath, itemId, mode) => {
    const items = get().items.map((i) =>
      i.id === itemId ? { ...i, tracking: mode } : i
    )
    set({ items })

    try {
      await window.api.config.setTracking(repoPath, itemId, mode)
    } catch (err) {
      const reverted = get().items.map((i) =>
        i.id === itemId ? { ...i, tracking: mode === 'local' ? 'shared' as const : 'local' as const } : i
      )
      set({ items: reverted })
      useToastStore.getState().addToast('error', err instanceof Error ? err.message : String(err))
    }
  },

  createCommand: async (repoPath, name, content) => {
    try {
      const item = await window.api.config.createCommand(repoPath, name, content)
      set({ items: [...get().items, item] })
    } catch (err) {
      useToastStore.getState().addToast('error', err instanceof Error ? err.message : String(err))
    }
  },

  createClaudeMd: async (repoPath, location, content) => {
    try {
      const item = await window.api.config.createClaudeMd(repoPath, location, content)
      set({ items: [...get().items, item] })
    } catch (err) {
      useToastStore.getState().addToast('error', err instanceof Error ? err.message : String(err))
    }
  },

  deleteItem: async (repoPath, itemId) => {
    const prev = get().items
    set({ items: prev.filter((i) => i.id !== itemId) })

    try {
      await window.api.config.delete(repoPath, itemId)
    } catch (err) {
      set({ items: prev })
      useToastStore.getState().addToast('error', err instanceof Error ? err.message : String(err))
    }
  },

  updateItems: (items) => set({ items }),
}))
