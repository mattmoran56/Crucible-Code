import { describe, expect, it } from 'vitest'
import { DEFAULT_OPTIMISTIC_STATUSES, resolveOptimisticStatuses } from '../../../src/shared/foundry'

describe('resolveOptimisticStatuses', () => {
  it('returns an empty list when optimistic continue is off', () => {
    expect(resolveOptimisticStatuses({ optimisticContinue: false, optimisticStatuses: ['In review'] })).toEqual([])
  })

  it('returns an empty list when optimisticContinue is undefined', () => {
    expect(resolveOptimisticStatuses({})).toEqual([])
  })

  it('defaults to ["In review"] when on with no configured statuses', () => {
    expect(resolveOptimisticStatuses({ optimisticContinue: true })).toEqual(['In review'])
    expect(resolveOptimisticStatuses({ optimisticContinue: true })).toEqual([...DEFAULT_OPTIMISTIC_STATUSES])
  })

  it('returns the configured statuses verbatim when on', () => {
    expect(
      resolveOptimisticStatuses({ optimisticContinue: true, optimisticStatuses: ['In review', 'QA'] })
    ).toEqual(['In review', 'QA'])
  })

  it('honors an explicitly empty configured list when on (does not fall back to the default)', () => {
    expect(resolveOptimisticStatuses({ optimisticContinue: true, optimisticStatuses: [] })).toEqual([])
  })

  it('does not return a reference to the shared default array (callers can mutate safely)', () => {
    const a = resolveOptimisticStatuses({ optimisticContinue: true })
    a.push('mutated')
    const b = resolveOptimisticStatuses({ optimisticContinue: true })
    expect(b).toEqual(['In review'])
    expect(DEFAULT_OPTIMISTIC_STATUSES).toEqual(['In review'])
  })
})
