import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_PR_LIST_DISPLAY } from '../../../src/shared/prDisplay'

const STORAGE_KEY = 'codecrucible-pr-list-display'

async function freshStore() {
  const mod = await import('../../../src/renderer/stores/prListDisplayStore')
  // Reset to pristine defaults — the singleton module persists between tests.
  mod.usePRListDisplayStore.setState({
    default: { ...DEFAULT_PR_LIST_DISPLAY, fields: { ...DEFAULT_PR_LIST_DISPLAY.fields } },
    byRepo: {},
  })
  return mod.usePRListDisplayStore
}

beforeEach(() => {
  localStorage.clear()
})

describe('prListDisplayStore (defaults)', () => {
  it('starts with the shared default', async () => {
    const store = await freshStore()
    expect(store.getState().default).toEqual(DEFAULT_PR_LIST_DISPLAY)
    expect(store.getState().byRepo).toEqual({})
  })
})

describe('prListDisplayStore.getEffective', () => {
  it('returns default when no override', async () => {
    const store = await freshStore()
    expect(store.getState().getEffective('/repo/a')).toEqual(store.getState().default)
  })

  it('returns repo override when present', async () => {
    const store = await freshStore()
    const next = {
      fields: { ...DEFAULT_PR_LIST_DISPLAY.fields, labels: true },
      labelFilter: { mode: 'all' as const },
    }
    store.getState().setForRepo('/repo/a', next)
    expect(store.getState().getEffective('/repo/a')).toEqual(next)
    expect(store.getState().getEffective('/repo/other')).toEqual(store.getState().default)
  })
})

describe('prListDisplayStore.patchDefault / patchForRepo', () => {
  it('patchDefault merges and persists', async () => {
    const store = await freshStore()
    store.getState().patchDefault({
      fields: { ...DEFAULT_PR_LIST_DISPLAY.fields, labels: true },
    })
    expect(store.getState().default.fields.labels).toBe(true)
    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(persisted.default.fields.labels).toBe(true)
  })

  it('patchForRepo seeds from default if no override exists', async () => {
    const store = await freshStore()
    store.getState().patchForRepo('/repo/a', {
      labelFilter: { mode: 'only', names: ['bug'] },
    })
    const eff = store.getState().getEffective('/repo/a')
    expect(eff.labelFilter).toEqual({ mode: 'only', names: ['bug'] })
    // Field flags should be inherited from default
    expect(eff.fields).toEqual(store.getState().default.fields)
  })
})

describe('prListDisplayStore.resetForRepo', () => {
  it('removes the override entry', async () => {
    const store = await freshStore()
    store.getState().setForRepo('/repo/a', {
      fields: { ...DEFAULT_PR_LIST_DISPLAY.fields, labels: true },
      labelFilter: { mode: 'all' },
    })
    expect(store.getState().byRepo['/repo/a']).toBeDefined()
    store.getState().resetForRepo('/repo/a')
    expect(store.getState().byRepo['/repo/a']).toBeUndefined()
  })
})

describe('prListDisplayStore.hasOverride', () => {
  it('false when override mirrors default', async () => {
    const store = await freshStore()
    store.getState().setForRepo('/repo/a', { ...DEFAULT_PR_LIST_DISPLAY })
    expect(store.getState().hasOverride('/repo/a')).toBe(false)
  })

  it('true when override differs from default', async () => {
    const store = await freshStore()
    store.getState().setForRepo('/repo/a', {
      fields: { ...DEFAULT_PR_LIST_DISPLAY.fields, labels: true },
      labelFilter: { mode: 'all' },
    })
    expect(store.getState().hasOverride('/repo/a')).toBe(true)
  })

  it('false for a repo with no entry', async () => {
    const store = await freshStore()
    expect(store.getState().hasOverride('/repo/missing')).toBe(false)
  })
})
