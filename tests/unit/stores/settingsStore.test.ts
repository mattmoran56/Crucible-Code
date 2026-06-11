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

describe('settingsStore (defaults, extended)', () => {
  it('falls back to defaults when persisted JSON is corrupted', async () => {
    localStorage.setItem(STORAGE_KEY, '{{{not json')
    const store = await loadStore()
    expect(store.getState().theme).toBe('dark')
    expect(store.getState().matchSystem).toBe(false)
  })

  it('seeds the documented defaults for the cleanup / queue / usage settings', async () => {
    const store = await loadStore()
    const s = store.getState()
    expect(s.mergedCleanupAction).toBe('deleteSession')
    expect(s.mergedCleanupDelay).toBe(30)
    expect(s.autoQueueContinue).toBe(false)
    expect(s.usageResetDelayMinutes).toBe(1)
  })

  it('backfills newer settings keys missing from an older persisted blob', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      theme: 'light',
      matchSystem: false,
      preferredLight: 'light',
      preferredDark: 'dark',
      // claudeTheme / cleanup / autoQueue / usage keys intentionally absent
    }))
    const store = await loadStore()
    const s = store.getState()
    expect(s.claudeTheme).toBe('light') // derived from THEMES default for 'light'
    expect(s.mergedCleanupAction).toBe('deleteSession')
    expect(s.mergedCleanupDelay).toBe(30)
    expect(s.autoQueueContinue).toBe(false)
    expect(s.usageResetDelayMinutes).toBe(1)
  })

  it('clamps an out-of-range persisted usage delay on load', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      theme: 'dark', matchSystem: false, preferredLight: 'light', preferredDark: 'dark',
      claudeTheme: 'dark', mergedCleanupAction: 'nothing', mergedCleanupDelay: 0,
      autoQueueContinue: true, usageResetDelayMinutes: 999,
    }))
    const store = await loadStore()
    expect(store.getState().usageResetDelayMinutes).toBe(30)
    expect(store.getState().autoQueueContinue).toBe(true)
  })

  it('resolves the system theme at module load when matchSystem was persisted', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      theme: 'dark', matchSystem: true, preferredLight: 'soft-light', preferredDark: 'ultra-dark',
      claudeTheme: 'dark', mergedCleanupAction: 'nothing', mergedCleanupDelay: 0,
    }))
    // matchMedia stub reports light → preferredLight wins
    const store = await loadStore()
    expect(store.getState().theme).toBe('soft-light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('soft-light')
  })
})

describe('settingsStore.setAutoQueueContinue', () => {
  it('updates state and persists', async () => {
    const store = await loadStore()
    store.getState().setAutoQueueContinue(true)
    expect(store.getState().autoQueueContinue).toBe(true)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).autoQueueContinue).toBe(true)
    store.getState().setAutoQueueContinue(false)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).autoQueueContinue).toBe(false)
  })
})

describe('settingsStore.setUsageResetDelayMinutes', () => {
  it('clamps below the minimum to 0', async () => {
    const store = await loadStore()
    store.getState().setUsageResetDelayMinutes(-5)
    expect(store.getState().usageResetDelayMinutes).toBe(0)
  })

  it('clamps above the maximum to 30', async () => {
    const store = await loadStore()
    store.getState().setUsageResetDelayMinutes(99)
    expect(store.getState().usageResetDelayMinutes).toBe(30)
  })

  it('rounds fractional minutes', async () => {
    const store = await loadStore()
    store.getState().setUsageResetDelayMinutes(2.6)
    expect(store.getState().usageResetDelayMinutes).toBe(3)
  })

  it('falls back to 1 for non-finite input', async () => {
    const store = await loadStore()
    store.getState().setUsageResetDelayMinutes(NaN)
    expect(store.getState().usageResetDelayMinutes).toBe(1)
    store.getState().setUsageResetDelayMinutes(Infinity)
    expect(store.getState().usageResetDelayMinutes).toBe(1)
  })

  it('persists the clamped value', async () => {
    const store = await loadStore()
    store.getState().setUsageResetDelayMinutes(12)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).usageResetDelayMinutes).toBe(12)
  })
})

describe('settingsStore.setPreferredDark (extended)', () => {
  it('persists preferredDark without touching the active theme when matchSystem is off', async () => {
    const store = await loadStore()
    const before = store.getState().theme
    store.getState().setPreferredDark('ultra-dark')
    expect(store.getState().preferredDark).toBe('ultra-dark')
    expect(store.getState().theme).toBe(before)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).preferredDark).toBe('ultra-dark')
  })

  it('does not change the resolved theme when matchSystem is on but the system is light', async () => {
    const store = await loadStore()
    store.getState().setMatchSystem(true) // system is light in this suite
    store.getState().setPreferredDark('ultra-dark')
    // System resolves via preferredLight, so the dark preference is dormant
    expect(store.getState().theme).toBe(store.getState().preferredLight)
  })
})

describe('settingsStore.setTheme claudeTheme derivation', () => {
  it('switching to a light theme flips claudeTheme to light', async () => {
    const store = await loadStore()
    store.getState().setTheme('soft-light')
    expect(store.getState().claudeTheme).toBe('light')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).claudeTheme).toBe('light')
  })
})
