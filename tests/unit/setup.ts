import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

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
