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

describe('prViewStore.get laziness', () => {
  it('does not create a byRepo entry just by reading', () => {
    usePRViewStore.getState().get('/repo/peek')
    expect(usePRViewStore.getState().byRepo).toEqual({})
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('returns the stored override once one exists', () => {
    usePRViewStore.getState().patch('/repo/a', { unseenOnly: true })
    expect(usePRViewStore.getState().get('/repo/a').unseenOnly).toBe(true)
  })
})

describe('prViewStore nested object replacement', () => {
  it('patching status swaps the whole status object', () => {
    usePRViewStore.getState().patch('/repo/a', { status: { ready: false, draft: false } })
    expect(usePRViewStore.getState().get('/repo/a').status).toEqual({ ready: false, draft: false })
  })

  it('patching ci swaps the whole ci object', () => {
    const ci = { success: true, failure: true, pending: false, none: false }
    usePRViewStore.getState().patch('/repo/a', { ci })
    expect(usePRViewStore.getState().get('/repo/a').ci).toEqual(ci)
  })

  it('a later unrelated patch preserves earlier nested overrides', () => {
    usePRViewStore.getState().patch('/repo/a', { status: { ready: true, draft: false } })
    usePRViewStore.getState().patch('/repo/a', { sortBy: 'updated' })
    const view = usePRViewStore.getState().get('/repo/a')
    expect(view.status).toEqual({ ready: true, draft: false })
    expect(view.sortBy).toBe('updated')
  })

  it('person filters replace each other wholesale', () => {
    usePRViewStore.getState().patch('/repo/a', { author: { kind: 'login', login: 'mattmoran' } })
    usePRViewStore.getState().patch('/repo/a', { author: { kind: 'me' } })
    expect(usePRViewStore.getState().get('/repo/a').author).toEqual({ kind: 'me' })
  })
})

describe('prViewStore reset persistence', () => {
  it('reset removes the entry from localStorage too', () => {
    usePRViewStore.getState().patch('/repo/a', { unseenOnly: true })
    usePRViewStore.getState().reset('/repo/a')
    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(persisted['/repo/a']).toBeUndefined()
  })

  it('reset leaves other repos intact in state and storage', () => {
    usePRViewStore.getState().patch('/repo/a', { unseenOnly: true })
    usePRViewStore.getState().patch('/repo/b', { sortBy: 'created' })
    usePRViewStore.getState().reset('/repo/a')
    expect(usePRViewStore.getState().byRepo['/repo/b'].sortBy).toBe('created')
    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(Object.keys(persisted)).toEqual(['/repo/b'])
  })

  it('patching again after a reset starts from the defaults', () => {
    usePRViewStore.getState().patch('/repo/a', { unseenOnly: true, sortBy: 'updated' })
    usePRViewStore.getState().reset('/repo/a')
    usePRViewStore.getState().patch('/repo/a', { sortBy: 'created' })
    const view = usePRViewStore.getState().get('/repo/a')
    expect(view.sortBy).toBe('created')
    expect(view.unseenOnly).toBe(false)
  })

  it('patch records an override entry even when the values equal the defaults', () => {
    usePRViewStore.getState().patch('/repo/a', { sortBy: 'number' })
    expect(usePRViewStore.getState().byRepo['/repo/a']).toEqual(DEFAULT_PR_VIEW)
    expect(isDefaultView(usePRViewStore.getState().byRepo['/repo/a'])).toBe(true)
  })

  it('persists overrides for multiple repos in a single storage payload', () => {
    usePRViewStore.getState().patch('/repo/a', { unseenOnly: true })
    usePRViewStore.getState().patch('/repo/b', { sortBy: 'updated' })
    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(persisted['/repo/a'].unseenOnly).toBe(true)
    expect(persisted['/repo/b'].sortBy).toBe('updated')
  })
})

describe('isDefaultView additional fields', () => {
  it('flags an assignee login filter as non-default', () => {
    expect(isDefaultView({ ...DEFAULT_PR_VIEW, assignee: { kind: 'login', login: 'x' } })).toBe(false)
  })

  it('flags a reviewer=me filter as non-default', () => {
    expect(isDefaultView({ ...DEFAULT_PR_VIEW, reviewer: { kind: 'me' } })).toBe(false)
  })

  it('flags ci.none=false as non-default', () => {
    expect(
      isDefaultView({
        ...DEFAULT_PR_VIEW,
        ci: { success: true, failure: true, pending: true, none: false },
      })
    ).toBe(false)
  })

  it('flags status.draft=false as non-default', () => {
    expect(isDefaultView({ ...DEFAULT_PR_VIEW, status: { ready: true, draft: false } })).toBe(false)
  })

  it('accepts a structural clone of the defaults, not just the same reference', () => {
    const clone = JSON.parse(JSON.stringify(DEFAULT_PR_VIEW))
    expect(isDefaultView(clone)).toBe(true)
  })
})
