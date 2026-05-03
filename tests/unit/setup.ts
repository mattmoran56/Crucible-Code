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
