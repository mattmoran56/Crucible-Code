import { create } from 'zustand'
import { THEMES, type ThemeName } from '../../shared/themes'

export type { ThemeName }

const STORAGE_KEY = 'codecrucible-settings'

interface PersistedSettings {
  theme: ThemeName
  matchSystem: boolean
  preferredLight: ThemeName
  preferredDark: ThemeName
}

function loadSettings(): PersistedSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return { theme: 'dark', matchSystem: false, preferredLight: 'light', preferredDark: 'dark' }
}

function saveSettings(s: PersistedSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
}

function applyTheme(theme: ThemeName) {
  document.documentElement.setAttribute('data-theme', theme)
}

function getSystemTheme(preferredLight: ThemeName, preferredDark: ThemeName): ThemeName {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? preferredDark
    : preferredLight
}

interface SettingsState {
  isOpen: boolean
  theme: ThemeName
  matchSystem: boolean
  preferredLight: ThemeName
  preferredDark: ThemeName
  openSettings: () => void
  closeSettings: () => void
  setTheme: (theme: ThemeName) => void
  setMatchSystem: (enabled: boolean) => void
  setPreferredLight: (theme: ThemeName) => void
  setPreferredDark: (theme: ThemeName) => void
}

const initial = loadSettings()
const initialTheme = initial.matchSystem
  ? getSystemTheme(initial.preferredLight, initial.preferredDark)
  : initial.theme
applyTheme(initialTheme)

export const useSettingsStore = create<SettingsState>((set, get) => ({
  isOpen: false,
  theme: initialTheme,
  matchSystem: initial.matchSystem,
  preferredLight: initial.preferredLight,
  preferredDark: initial.preferredDark,
  openSettings: () => set({ isOpen: true }),
  closeSettings: () => set({ isOpen: false }),
  setTheme: (theme) => {
    applyTheme(theme)
    set({ theme, matchSystem: false })
    const s = get()
    saveSettings({ theme, matchSystem: false, preferredLight: s.preferredLight, preferredDark: s.preferredDark })
  },
  setMatchSystem: (enabled) => {
    const s = get()
    if (enabled) {
      const resolved = getSystemTheme(s.preferredLight, s.preferredDark)
      applyTheme(resolved)
      set({ matchSystem: true, theme: resolved })
      saveSettings({ theme: resolved, matchSystem: true, preferredLight: s.preferredLight, preferredDark: s.preferredDark })
    } else {
      set({ matchSystem: false })
      saveSettings({ theme: s.theme, matchSystem: false, preferredLight: s.preferredLight, preferredDark: s.preferredDark })
    }
  },
  setPreferredLight: (theme) => {
    const s = get()
    set({ preferredLight: theme })
    if (s.matchSystem) {
      const resolved = getSystemTheme(theme, s.preferredDark)
      applyTheme(resolved)
      set({ theme: resolved })
      saveSettings({ theme: resolved, matchSystem: true, preferredLight: theme, preferredDark: s.preferredDark })
    } else {
      saveSettings({ theme: s.theme, matchSystem: false, preferredLight: theme, preferredDark: s.preferredDark })
    }
  },
  setPreferredDark: (theme) => {
    const s = get()
    set({ preferredDark: theme })
    if (s.matchSystem) {
      const resolved = getSystemTheme(s.preferredLight, theme)
      applyTheme(resolved)
      set({ theme: resolved })
      saveSettings({ theme: resolved, matchSystem: true, preferredLight: s.preferredLight, preferredDark: theme })
    } else {
      saveSettings({ theme: s.theme, matchSystem: false, preferredLight: s.preferredLight, preferredDark: theme })
    }
  },
}))

// Listen for OS color scheme changes
const mq = window.matchMedia('(prefers-color-scheme: dark)')
mq.addEventListener('change', () => {
  const s = useSettingsStore.getState()
  if (s.matchSystem) {
    const resolved = getSystemTheme(s.preferredLight, s.preferredDark)
    applyTheme(resolved)
    useSettingsStore.setState({ theme: resolved })
    saveSettings({ theme: resolved, matchSystem: true, preferredLight: s.preferredLight, preferredDark: s.preferredDark })
  }
})
