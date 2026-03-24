import { create } from 'zustand'
import type { ThemeName } from '../../shared/themes'

export type { ThemeName }

const THEME_STORAGE_KEY = 'codecrucible-theme'

function loadTheme(): ThemeName {
  const stored = localStorage.getItem(THEME_STORAGE_KEY) as ThemeName | null
  const theme = stored || 'dark'
  document.documentElement.setAttribute('data-theme', theme)
  return theme
}

interface SettingsState {
  isOpen: boolean
  theme: ThemeName
  openSettings: () => void
  closeSettings: () => void
  setTheme: (theme: ThemeName) => void
}

export const useSettingsStore = create<SettingsState>((set) => ({
  isOpen: false,
  theme: loadTheme(),
  openSettings: () => set({ isOpen: true }),
  closeSettings: () => set({ isOpen: false }),
  setTheme: (theme) => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem(THEME_STORAGE_KEY, theme)
    set({ theme })
  },
}))
