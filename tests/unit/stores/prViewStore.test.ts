import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_PR_VIEW,
  isDefaultView,
  usePRViewStore,
} from '../../../src/renderer/stores/prViewStore'

const STORAGE_KEY = 'codecrucible-pr-view'

beforeEach(() => {
  localStorage.clear()
  usePRViewStore.setState({ byRepo: {} })
})

describe('isDefaultView', () => {
  it('returns true for the canonical default', () => {
    expect(isDefaultView(DEFAULT_PR_VIEW)).toBe(true)
  })

  it('returns false when any flag differs', () => {
    expect(isDefaultView({ ...DEFAULT_PR_VIEW, unseenOnly: true })).toBe(false)
    expect(isDefaultView({ ...DEFAULT_PR_VIEW, sortBy: 'updated' })).toBe(false)
    expect(isDefaultView({
      ...DEFAULT_PR_VIEW,
      status: { ready: false, draft: true },
    })).toBe(false)
    expect(isDefaultView({
      ...DEFAULT_PR_VIEW,
      author: { kind: 'me' },
    })).toBe(false)
    expect(isDefaultView({
      ...DEFAULT_PR_VIEW,
      ci: { success: false, failure: true, pending: true, none: true },
    })).toBe(false)
  })
})

describe('prViewStore.get', () => {
  it('returns the default for a repo with no override', () => {
    expect(usePRViewStore.getState().get('/repo/a')).toEqual(DEFAULT_PR_VIEW)
  })
})

describe('prViewStore.patch', () => {
  it('seeds an override from default and persists it', () => {
    usePRViewStore.getState().patch('/repo/a', { sortBy: 'updated' })
    const view = usePRViewStore.getState().get('/repo/a')
    expect(view.sortBy).toBe('updated')
    // unrelated fields stay at default
    expect(view.unseenOnly).toBe(false)
    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(persisted['/repo/a'].sortBy).toBe('updated')
  })

  it('layers multiple patches without losing earlier values', () => {
    usePRViewStore.getState().patch('/repo/a', { sortBy: 'created' })
    usePRViewStore.getState().patch('/repo/a', { unseenOnly: true })
    const view = usePRViewStore.getState().get('/repo/a')
    expect(view.sortBy).toBe('created')
    expect(view.unseenOnly).toBe(true)
  })

  it('keeps overrides per-repo isolated', () => {
    usePRViewStore.getState().patch('/repo/a', { sortBy: 'updated' })
    usePRViewStore.getState().patch('/repo/b', { sortBy: 'created' })
    expect(usePRViewStore.getState().get('/repo/a').sortBy).toBe('updated')
    expect(usePRViewStore.getState().get('/repo/b').sortBy).toBe('created')
  })
})

describe('prViewStore.reset', () => {
  it('removes the override entry', () => {
    usePRViewStore.getState().patch('/repo/a', { unseenOnly: true })
    usePRViewStore.getState().reset('/repo/a')
    expect(usePRViewStore.getState().byRepo['/repo/a']).toBeUndefined()
  })

  it('is a no-op for an unknown repo', () => {
    usePRViewStore.getState().reset('/repo/missing')
    expect(usePRViewStore.getState().byRepo).toEqual({})
  })
})
