// Dictation mode for visual agents: when on, text pasted into the composer
// (which is how dictation apps hand over what you said) is sent straight away,
// as if Enter had been pressed. One app-wide switch, on by default.
//
// Smart dictation (Settings → Dictation, on by default) narrows that to pastes
// a dictation app made (it marks the clipboard), so a paste of your own waits
// for Enter. Normal dictation sends every text paste.

import { create } from 'zustand'

const STORAGE_KEY = 'codecrucible-dictation-mode'
const SMART_STORAGE_KEY = 'codecrucible-dictation-smart'

function load(key: string): boolean {
  try {
    const raw = localStorage.getItem(key)
    if (raw !== null) return JSON.parse(raw) !== false
  } catch { /* ignore */ }
  return true
}

function save(key: string, value: boolean) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch { /* ignore */ }
}

interface DictationState {
  enabled: boolean
  /** Only send pastes a dictation app made. */
  smart: boolean
  setEnabled: (enabled: boolean) => void
  setSmart: (smart: boolean) => void
  toggle: () => void
}

export const useDictationStore = create<DictationState>((set, get) => ({
  enabled: load(STORAGE_KEY),
  smart: load(SMART_STORAGE_KEY),
  setEnabled: (enabled) => {
    save(STORAGE_KEY, enabled)
    set({ enabled })
  },
  setSmart: (smart) => {
    save(SMART_STORAGE_KEY, smart)
    set({ smart })
  },
  toggle: () => get().setEnabled(!get().enabled),
}))
