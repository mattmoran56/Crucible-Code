import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// jsdom doesn't ship matchMedia. The settings store reads it at module load
// to resolve the OS theme, so we provide a stable stub.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

// jsdom doesn't implement scrollIntoView; the roving-index hook uses it after
// arrow-key navigation, so we no-op it.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {}
}

// jsdom 26 added a partial ResizeObserver but stories that read it expect a
// constructor that takes a callback.
if (typeof globalThis.ResizeObserver === 'undefined') {
  ;(globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

// jsdom on Node 26 doesn't expose localStorage/sessionStorage; many stores read
// them at module load (and tests call localStorage.clear() in beforeEach). On
// CI's Node 22 jsdom provides them, so this guard is a no-op there — it only
// fills the gap locally so the component suite matches CI. In-memory Storage.
if (typeof window !== 'undefined' && !window.localStorage) {
  const makeStorage = (): Storage => {
    let store: Record<string, string> = {}
    return {
      get length() {
        return Object.keys(store).length
      },
      clear: () => {
        store = {}
      },
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = String(v)
      },
      removeItem: (k: string) => {
        delete store[k]
      },
      key: (i: number) => Object.keys(store)[i] ?? null,
    } as Storage
  }
  Object.defineProperty(window, 'localStorage', { configurable: true, value: makeStorage() })
  Object.defineProperty(window, 'sessionStorage', { configurable: true, value: makeStorage() })
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

if (typeof globalThis.crypto === 'undefined' || typeof globalThis.crypto.randomUUID !== 'function') {
  let counter = 0
  Object.defineProperty(globalThis, 'crypto', {
    value: {
      ...(globalThis.crypto ?? {}),
      randomUUID: () => `test-uuid-${++counter}-${Date.now()}`,
    },
    configurable: true,
  })
}
