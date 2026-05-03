import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PR_LIST_DISPLAY,
  PR_LIST_FIELDS,
  displaysEqual,
  type PRListDisplay,
} from '../../../src/shared/prDisplay'

function clone(d: PRListDisplay): PRListDisplay {
  return {
    fields: { ...d.fields },
    labelFilter:
      d.labelFilter.mode === 'all'
        ? { mode: 'all' }
        : { mode: 'only', names: [...d.labelFilter.names] },
  }
}

describe('PR_LIST_FIELDS / DEFAULT_PR_LIST_DISPLAY', () => {
  it('default display has an entry for every declared field', () => {
    for (const { key } of PR_LIST_FIELDS) {
      expect(typeof DEFAULT_PR_LIST_DISPLAY.fields[key]).toBe('boolean')
    }
  })
})

describe('displaysEqual', () => {
  it('equal when the same instance', () => {
    expect(displaysEqual(DEFAULT_PR_LIST_DISPLAY, DEFAULT_PR_LIST_DISPLAY)).toBe(true)
  })

  it('equal when structurally identical', () => {
    const a = clone(DEFAULT_PR_LIST_DISPLAY)
    const b = clone(DEFAULT_PR_LIST_DISPLAY)
    expect(displaysEqual(a, b)).toBe(true)
  })

  it('not equal when one field flag differs', () => {
    const a = clone(DEFAULT_PR_LIST_DISPLAY)
    const b = clone(DEFAULT_PR_LIST_DISPLAY)
    b.fields.labels = !b.fields.labels
    expect(displaysEqual(a, b)).toBe(false)
  })

  it('not equal when label filter mode differs', () => {
    const a: PRListDisplay = { ...clone(DEFAULT_PR_LIST_DISPLAY), labelFilter: { mode: 'all' } }
    const b: PRListDisplay = {
      ...clone(DEFAULT_PR_LIST_DISPLAY),
      labelFilter: { mode: 'only', names: ['bug'] },
    }
    expect(displaysEqual(a, b)).toBe(false)
  })

  it('treats label-name order as irrelevant', () => {
    const a: PRListDisplay = {
      ...clone(DEFAULT_PR_LIST_DISPLAY),
      labelFilter: { mode: 'only', names: ['bug', 'enhancement'] },
    }
    const b: PRListDisplay = {
      ...clone(DEFAULT_PR_LIST_DISPLAY),
      labelFilter: { mode: 'only', names: ['enhancement', 'bug'] },
    }
    expect(displaysEqual(a, b)).toBe(true)
  })

  it('not equal when label name lists differ', () => {
    const a: PRListDisplay = {
      ...clone(DEFAULT_PR_LIST_DISPLAY),
      labelFilter: { mode: 'only', names: ['bug'] },
    }
    const b: PRListDisplay = {
      ...clone(DEFAULT_PR_LIST_DISPLAY),
      labelFilter: { mode: 'only', names: ['bug', 'enhancement'] },
    }
    expect(displaysEqual(a, b)).toBe(false)
  })
})
