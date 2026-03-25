import { create } from 'zustand'
import { THEMES, type ThemeName, type ClaudeTheme } from '../../shared/themes'

export type { ThemeName, ClaudeTheme }

const STORAGE_KEY = 'codecrucible-settings'

interface PersistedSettings {
  theme: ThemeName
  matchSystem: boolean
  preferredLight: ThemeName
  preferredDark: ThemeName
  claudeTheme: ClaudeTheme
}

function getDefaultClaudeTheme(theme: ThemeName): ClaudeTheme {
  return THEMES.find((t) => t.name === theme)?.claudeTheme ?? 'dark'
}

function loadSettings(): PersistedSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return { theme: 'dark', matchSystem: false, preferredLight: 'light', preferredDark: 'dark', claudeTheme: 'dark' }
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
  claudeTheme: ClaudeTheme
  openSettings: () => void
  closeSettings: () => void
  setTheme: (theme: ThemeName) => void
  setMatchSystem: (enabled: boolean) => void
  setPreferredLight: (theme: ThemeName) => void
  setPreferredDark: (theme: ThemeName) => void
  setClaudeTheme: (claudeTheme: ClaudeTheme) => void
}

const initial = loadSettings()
const initialTheme = initial.matchSystem
  ? getSystemTheme(initial.preferredLight, initial.preferredDark)
  : initial.theme
applyTheme(initialTheme)

function persist(get: () => SettingsState, overrides: Partial<PersistedSettings> = {}) {
  const s = get()
  saveSettings({
    theme: s.theme,
    matchSystem: s.matchSystem,
    preferredLight: s.preferredLight,
    preferredDark: s.preferredDark,
    claudeTheme: s.claudeTheme,
    ...overrides,
  })
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  isOpen: false,
  theme: initialTheme,
  matchSystem: initial.matchSystem,
  preferredLight: initial.preferredLight,
  preferredDark: initial.preferredDark,
  claudeTheme: initial.claudeTheme ?? getDefaultClaudeTheme(initialTheme),
  openSettings: () => set({ isOpen: true }),
  closeSettings: () => set({ isOpen: false }),
  setTheme: (theme) => {
    applyTheme(theme)
    const claudeTheme = getDefaultClaudeTheme(theme)
    set({ theme, matchSystem: false, claudeTheme })
    persist(get, { theme, matchSystem: false, claudeTheme })
  },
  setMatchSystem: (enabled) => {
    const s = get()
    if (enabled) {
      const resolved = getSystemTheme(s.preferredLight, s.preferredDark)
      applyTheme(resolved)
      const claudeTheme = getDefaultClaudeTheme(resolved)
      set({ matchSystem: true, theme: resolved, claudeTheme })
      persist(get, { theme: resolved, matchSystem: true, claudeTheme })
    } else {
      set({ matchSystem: false })
      persist(get, { matchSystem: false })
    }
  },
  setPreferredLight: (theme) => {
    const s = get()
    set({ preferredLight: theme })
    if (s.matchSystem) {
      const resolved = getSystemTheme(theme, s.preferredDark)
      applyTheme(resolved)
      const claudeTheme = getDefaultClaudeTheme(resolved)
      set({ theme: resolved, claudeTheme })
      persist(get, { theme: resolved, matchSystem: true, preferredLight: theme, claudeTheme })
    } else {
      persist(get, { preferredLight: theme })
    }
  },
  setPreferredDark: (theme) => {
    const s = get()
    set({ preferredDark: theme })
    if (s.matchSystem) {
      const resolved = getSystemTheme(s.preferredLight, theme)
      applyTheme(resolved)
      const claudeTheme = getDefaultClaudeTheme(resolved)
      set({ theme: resolved, claudeTheme })
      persist(get, { theme: resolved, matchSystem: true, preferredDark: theme, claudeTheme })
    } else {
      persist(get, { preferredDark: theme })
    }
  },
  setClaudeTheme: (claudeTheme) => {
    set({ claudeTheme })
    persist(get, { claudeTheme })
  },
}))

// Listen for OS color scheme changes
const mq = window.matchMedia('(prefers-color-scheme: dark)')
mq.addEventListener('change', () => {
  const s = useSettingsStore.getState()
  if (s.matchSystem) {
    const resolved = getSystemTheme(s.preferredLight, s.preferredDark)
    applyTheme(resolved)
    const claudeTheme = getDefaultClaudeTheme(resolved)
    useSettingsStore.setState({ theme: resolved, claudeTheme })
    saveSettings({ theme: resolved, matchSystem: true, preferredLight: s.preferredLight, preferredDark: s.preferredDark, claudeTheme })
  }
})
