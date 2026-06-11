import { create } from 'zustand'
import type { FoundryConfig, FoundryRuntimeState } from '../../shared/types'

interface FoundryStore {
  configs: FoundryConfig[]
  states: Record<string, FoundryRuntimeState>
  setConfigs: (configs: FoundryConfig[]) => void
  upsertState: (foundryId: string, state: FoundryRuntimeState) => void
  /** Convenience reload that re-fetches everything from main. */
  reload: () => Promise<void>
  save: (cfg: FoundryConfig) => Promise<void>
  remove: (foundryId: string) => Promise<void>
  setPaused: (foundryId: string, paused: boolean) => Promise<void>
  runNow: (foundryId: string) => Promise<void>
  resetState: (foundryId: string) => Promise<{ ok: boolean; reason?: string }>
}

export const useFoundryStore = create<FoundryStore>((set, get) => ({
  configs: [],
  states: {},
  setConfigs: (configs) => set({ configs }),
  upsertState: (foundryId, state) =>
    set((s) => ({ states: { ...s.states, [foundryId]: state } })),
  reload: async () => {
    const configs = await window.api.foundry.list()
    const states: Record<string, FoundryRuntimeState> = {}
    for (const c of configs) {
      const s = await window.api.foundry.getState(c.id)
      if (s) states[c.id] = s
    }
    set({ configs, states })
  },
  save: async (cfg) => {
    const next = await window.api.foundry.save(cfg)
    set({ configs: next })
  },
  remove: async (foundryId) => {
    const next = await window.api.foundry.delete(foundryId)
    set({ configs: next })
  },
  setPaused: async (foundryId, paused) => {
    await window.api.foundry.setPaused(foundryId, paused)
    await get().reload()
  },
  runNow: async (foundryId) => {
    await window.api.foundry.runNow(foundryId)
  },
  resetState: async (foundryId) => {
    const result = await window.api.foundry.resetState(foundryId)
    if (result.ok) await get().reload()
    return result
  },
}))
