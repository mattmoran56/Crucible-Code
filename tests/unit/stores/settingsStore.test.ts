import { beforeEach, describe, expect, it, vi } from 'vitest'

const STORAGE_KEY = 'codecrucible-settings'

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  vi.resetModules()
  // Default: light system theme so tests are deterministic
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({
      matches: false,
      media: '(prefers-color-scheme: dark)',
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    }),
  })
})

async function loadStore() {
  const mod = await import('../../../src/renderer/stores/settingsStore')
  return mod.useSettingsStore
}

describe('settingsStore (defaults)', () => {
  it('starts dialog closed and applies the persisted theme to <html data-theme>', async () => {
    const store = await loadStore()
    expect(store.getState().isOpen).toBe(false)
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('honours a previously persisted theme', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      theme: 'light',
      matchSystem: false,
      preferredLight: 'light',
      preferredDark: 'dark',
      claudeTheme: 'light',
      mergedCleanupAction: 'nothing',
      mergedCleanupDelay: 0,
    }))
    const store = await loadStore()
    expect(store.getState().theme).toBe('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })
})

describe('settingsStore.openSettings / closeSettings', () => {
  it('toggles the isOpen flag', async () => {
    const store = await loadStore()
    store.getState().openSettings()
    expect(store.getState().isOpen).toBe(true)
    store.getState().closeSettings()
    expect(store.getState().isOpen).toBe(false)
  })
})

describe('settingsStore.setTheme', () => {
  it('applies the theme to the dom and disables matchSystem', async () => {
    const store = await loadStore()
    store.getState().setMatchSystem(true)
    store.getState().setTheme('ultra-dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('ultra-dark')
    expect(store.getState().theme).toBe('ultra-dark')
    expect(store.getState().matchSystem).toBe(false)
    expect(store.getState().claudeTheme).toBe('dark')
  })

  it('persists every change through to localStorage', async () => {
    const store = await loadStore()
    store.getState().setTheme('light')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).theme).toBe('light')
  })
})

describe('settingsStore.setMatchSystem', () => {
  it('resolves to the preferredLight theme when system is light', async () => {
    const store = await loadStore()
    store.getState().setPreferredLight('soft-light')
    store.getState().setMatchSystem(true)
    expect(store.getState().theme).toBe('soft-light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('soft-light')
  })

  it('resolves to the preferredDark theme when system is dark', async () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({
        matches: true,
        media: '(prefers-color-scheme: dark)',
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
        onchange: null,
      }),
    })
    const store = await loadStore()
    store.getState().setPreferredDark('ultra-dark')
    store.getState().setMatchSystem(true)
    expect(store.getState().theme).toBe('ultra-dark')
  })

  it('disables match-system without changing the explicit theme', async () => {
    const store = await loadStore()
    store.getState().setMatchSystem(true)
    store.getState().setMatchSystem(false)
    expect(store.getState().matchSystem).toBe(false)
  })
})

describe('settingsStore.setPreferredLight / setPreferredDark', () => {
  it('updates the preferred theme without changing the active theme when matchSystem is off', async () => {
    const store = await loadStore()
    const before = store.getState().theme
    store.getState().setPreferredLight('soft-light')
    expect(store.getState().preferredLight).toBe('soft-light')
    expect(store.getState().theme).toBe(before)
  })

  it('updates the active theme when matchSystem is on', async () => {
    const store = await loadStore()
    store.getState().setMatchSystem(true)
    store.getState().setPreferredLight('soft-light')
    expect(store.getState().theme).toBe('soft-light')
  })
})

describe('settingsStore.setClaudeTheme / setMergedCleanup*', () => {
  it('setClaudeTheme persists', async () => {
    const store = await loadStore()
    store.getState().setClaudeTheme('light')
    expect(store.getState().claudeTheme).toBe('light')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).claudeTheme).toBe('light')
  })

  it('setMergedCleanupAction persists', async () => {
    const store = await loadStore()
    store.getState().setMergedCleanupAction('closeTerminals')
    expect(store.getState().mergedCleanupAction).toBe('closeTerminals')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).mergedCleanupAction).toBe('closeTerminals')
  })

  it('setMergedCleanupDelay persists', async () => {
    const store = await loadStore()
    store.getState().setMergedCleanupDelay(120)
    expect(store.getState().mergedCleanupDelay).toBe(120)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).mergedCleanupDelay).toBe(120)
  })
})
