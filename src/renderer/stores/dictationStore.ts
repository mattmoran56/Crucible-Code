// Dictation mode for visual agents: when on, text pasted into the composer
// (which is how dictation apps hand over what you said) is sent straight away,
// as if Enter had been pressed. One app-wide switch, on by default.

import { create } from 'zustand'

const STORAGE_KEY = 'codecrucible-dictation-mode'

function load(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw !== null) return JSON.parse(raw) !== false
  } catch { /* ignore */ }
  return true
}

function save(enabled: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(enabled))
  } catch { /* ignore */ }
}

interface DictationState {
  enabled: boolean
  setEnabled: (enabled: boolean) => void
  toggle: () => void
}

export const useDictationStore = create<DictationState>((set, get) => ({
  enabled: load(),
  setEnabled: (enabled) => {
    save(enabled)
    set({ enabled })
  },
  toggle: () => get().setEnabled(!get().enabled),
}))
