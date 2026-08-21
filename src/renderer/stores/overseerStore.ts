import { create } from 'zustand'
import type { OverseerSettings, OverseerState } from '../../shared/types'

/**
 * Thin mirror of the main-process Overseer. All the state lives in
 * `overseer.service.ts` — the panel only reflects what arrives over
 * OVERSEER_STATE_UPDATE, so a heartbeat that fires while the panel is closed
 * still lands in the thread.
 */
interface OverseerStoreState {
  state: OverseerState
  settings: OverseerSettings | null
  loaded: boolean

  load: () => Promise<void>
  applyState: (state: OverseerState) => void
  send: (text: string) => Promise<void>
  cancel: () => Promise<void>
  clear: () => Promise<void>
  heartbeatNow: () => Promise<void>
  markRead: () => Promise<void>
  saveSettings: (patch: Partial<OverseerSettings>) => Promise<void>
}

const EMPTY_STATE: OverseerState = {
  messages: [],
  running: false,
  spendTodayUsd: 0,
  spendDay: '',
  unread: 0,
}

export const useOverseerStore = create<OverseerStoreState>((set, get) => ({
  state: EMPTY_STATE,
  settings: null,
  loaded: false,

  load: async () => {
    const [state, settings] = await Promise.all([
      window.api.overseer.getState(),
      window.api.overseer.getSettings(),
    ])
    set({ state, settings, loaded: true })
  },

  applyState: (state) => set({ state }),

  send: async (text) => {
    const trimmed = text.trim()
    if (!trimmed) return
    await window.api.overseer.send(trimmed)
  },

  cancel: async () => {
    await window.api.overseer.cancel()
  },

  clear: async () => {
    await window.api.overseer.clear()
    set({ state: { ...get().state, messages: [] } })
  },

  heartbeatNow: async () => {
    await window.api.overseer.heartbeatNow()
  },

  markRead: async () => {
    await window.api.overseer.markRead()
  },

  saveSettings: async (patch) => {
    const settings = await window.api.overseer.setSettings(patch)
    set({ settings })
  },
}))
