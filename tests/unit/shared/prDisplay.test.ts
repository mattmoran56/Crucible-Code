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

describe('PR_LIST_FIELDS invariants', () => {
  it('declares exactly 13 fields', () => {
    expect(PR_LIST_FIELDS).toHaveLength(13)
  })

  it('field keys are unique', () => {
    const keys = PR_LIST_FIELDS.map((f) => f.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('field keys appear in the documented order', () => {
    expect(PR_LIST_FIELDS.map((f) => f.key)).toEqual([
      'state', 'ci', 'unseen', 'attention', 'number', 'branches', 'author',
      'labels', 'requestedReviewers', 'reviewerStates', 'assignees',
      'commentsCount', 'updatedAt',
    ])
  })

  it('every field has a non-empty label and description', () => {
    for (const f of PR_LIST_FIELDS) {
      expect(f.label.trim().length).toBeGreaterThan(0)
      expect(f.description.trim().length).toBeGreaterThan(0)
    }
  })

  it('labels are unique across fields', () => {
    const labels = PR_LIST_FIELDS.map((f) => f.label)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('default display declares no extra keys beyond PR_LIST_FIELDS', () => {
    const declared = PR_LIST_FIELDS.map((f) => f.key).sort()
    expect(Object.keys(DEFAULT_PR_LIST_DISPLAY.fields).sort()).toEqual(declared)
  })

  it('default shows exactly the core seven fields', () => {
    const visible = Object.entries(DEFAULT_PR_LIST_DISPLAY.fields)
      .filter(([, on]) => on)
      .map(([k]) => k)
      .sort()
    expect(visible).toEqual(
      ['attention', 'author', 'branches', 'ci', 'number', 'state', 'unseen'].sort(),
    )
  })

  it('default label filter shows all labels', () => {
    expect(DEFAULT_PR_LIST_DISPLAY.labelFilter).toEqual({ mode: 'all' })
  })
})

describe('displaysEqual — per-field sensitivity', () => {
  it.each(PR_LIST_FIELDS.map((f) => f.key))(
    'flipping the %s flag breaks equality (both directions)',
    (key) => {
      const a = clone(DEFAULT_PR_LIST_DISPLAY)
      const b = clone(DEFAULT_PR_LIST_DISPLAY)
      b.fields[key] = !b.fields[key]
      expect(displaysEqual(a, b)).toBe(false)
      expect(displaysEqual(b, a)).toBe(false)
    },
  )
})

describe('displaysEqual — label filter edge cases', () => {
  const withOnly = (names: string[]): PRListDisplay => ({
    ...clone(DEFAULT_PR_LIST_DISPLAY),
    labelFilter: { mode: 'only', names },
  })

  it('two empty "only" filters are equal', () => {
    expect(displaysEqual(withOnly([]), withOnly([]))).toBe(true)
  })

  it('empty "only" differs from a populated one', () => {
    expect(displaysEqual(withOnly([]), withOnly(['bug']))).toBe(false)
  })

  it('"only" with empty names is still different from "all"', () => {
    const all: PRListDisplay = { ...clone(DEFAULT_PR_LIST_DISPLAY), labelFilter: { mode: 'all' } }
    expect(displaysEqual(withOnly([]), all)).toBe(false)
    expect(displaysEqual(all, withOnly([]))).toBe(false)
  })

  it('is symmetric for order-shuffled name lists', () => {
    const a = withOnly(['a', 'b', 'c'])
    const b = withOnly(['c', 'a', 'b'])
    expect(displaysEqual(a, b)).toBe(true)
    expect(displaysEqual(b, a)).toBe(true)
  })

  it('duplicate names must match in multiplicity', () => {
    expect(displaysEqual(withOnly(['bug', 'bug']), withOnly(['bug', 'bug']))).toBe(true)
    expect(displaysEqual(withOnly(['bug', 'bug']), withOnly(['bug']))).toBe(false)
  })

  it('same length but different duplicate distribution is not equal', () => {
    expect(displaysEqual(withOnly(['a', 'a', 'b']), withOnly(['a', 'b', 'b']))).toBe(false)
  })

  it('label names are case-sensitive', () => {
    expect(displaysEqual(withOnly(['Bug']), withOnly(['bug']))).toBe(false)
  })

  it('does not unicode-normalize names (NFC vs NFD differ)', () => {
    // 'café' composed vs decomposed — visually identical, different code points.
    const composed = 'caf\u00e9'
    const decomposed = 'cafe\u0301'
    expect(composed).not.toBe(decomposed)
    expect(composed.normalize('NFC')).toBe(decomposed.normalize('NFC')) // same glyphs
    expect(displaysEqual(withOnly([composed]), withOnly([decomposed]))).toBe(false)
  })

  it('numeric-looking names compare as strings ("10" vs "9" order-insensitively)', () => {
    expect(displaysEqual(withOnly(['10', '9']), withOnly(['9', '10']))).toBe(true)
  })

  it('does not mutate the input name arrays', () => {
    const namesA = ['z', 'a', 'm']
    const namesB = ['m', 'z', 'a']
    displaysEqual(withOnly(namesA), withOnly(namesB))
    expect(namesA).toEqual(['z', 'a', 'm'])
    expect(namesB).toEqual(['m', 'z', 'a'])
  })

  it('handles a large shuffled name list', () => {
    const base = Array.from({ length: 500 }, (_, i) => `label-${i}`)
    const shuffled = [...base].reverse()
    expect(displaysEqual(withOnly(base), withOnly(shuffled))).toBe(true)
    expect(displaysEqual(withOnly(base), withOnly([...base.slice(1), 'label-extra']))).toBe(false)
  })

  it('ignores stray names on an "all" filter (current behavior — names not compared)', () => {
    const a: PRListDisplay = {
      ...clone(DEFAULT_PR_LIST_DISPLAY),
      labelFilter: { mode: 'all', names: ['stray'] } as unknown as PRListDisplay['labelFilter'],
    }
    const b: PRListDisplay = { ...clone(DEFAULT_PR_LIST_DISPLAY), labelFilter: { mode: 'all' } }
    expect(displaysEqual(a, b)).toBe(true)
  })

  it('ignores unknown extra field keys (current behavior — only declared fields compared)', () => {
    const a = clone(DEFAULT_PR_LIST_DISPLAY)
    ;(a.fields as Record<string, boolean>).bogus = true
    const b = clone(DEFAULT_PR_LIST_DISPLAY)
    expect(displaysEqual(a, b)).toBe(true)
  })
})
