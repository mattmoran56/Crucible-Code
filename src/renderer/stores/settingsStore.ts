import { create } from 'zustand'

export type ThemeName = 'dark' | 'light' | 'ultra-dark'

interface SettingsState {
  isOpen: boolean
  theme: ThemeName
  openSettings: () => void
  closeSettings: () => void
  setTheme: (theme: ThemeName) => void
}

export const useSettingsStore = create<SettingsState>((set) => ({
  isOpen: false,
  theme: (document.documentElement.getAttribute('data-theme') as ThemeName) || 'dark',
  openSettings: () => set({ isOpen: true }),
  closeSettings: () => set({ isOpen: false }),
  setTheme: (theme) => {
    document.documentElement.setAttribute('data-theme', theme)
    set({ theme })
  },
}))
