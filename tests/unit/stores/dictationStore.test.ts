import { beforeEach, describe, expect, it, vi } from 'vitest'

const STORAGE_KEY = 'codecrucible-dictation-mode'

async function freshStore() {
  vi.resetModules()
  const mod = await import('../../../src/renderer/stores/dictationStore')
  return mod.useDictationStore
}

beforeEach(() => {
  localStorage.clear()
})

describe('dictationStore', () => {
  it('is on by default', async () => {
    const store = await freshStore()
    expect(store.getState().enabled).toBe(true)
  })

  it('persists turning it off and back on', async () => {
    let store = await freshStore()
    store.getState().toggle()
    expect(store.getState().enabled).toBe(false)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('false')
    store = await freshStore()
    expect(store.getState().enabled).toBe(false)
    store.getState().setEnabled(true)
    store = await freshStore()
    expect(store.getState().enabled).toBe(true)
  })

  it('falls back to on when the stored value is unreadable', async () => {
    localStorage.setItem(STORAGE_KEY, '{nope')
    const store = await freshStore()
    expect(store.getState().enabled).toBe(true)
  })

  it('uses smart dictation by default and remembers switching to normal', async () => {
    let store = await freshStore()
    expect(store.getState().smart).toBe(true)
    store.getState().setSmart(false)
    expect(localStorage.getItem('codecrucible-dictation-smart')).toBe('false')
    store = await freshStore()
    expect(store.getState().smart).toBe(false)
    expect(store.getState().enabled).toBe(true)
  })
})
