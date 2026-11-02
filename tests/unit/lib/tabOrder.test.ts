import { describe, expect, it } from 'vitest'
import { moveToInsertionPoint, neighbourAfterClose, parseTabDragPayload } from '../../../src/renderer/lib/tabOrder'

describe('moveToInsertionPoint', () => {
  const ids = ['a', 'b', 'c', 'd']

  it('moves a tab right (insertion point counts the original slots)', () => {
    expect(moveToInsertionPoint(ids, 0, 2)).toEqual(['b', 'a', 'c', 'd'])
    expect(moveToInsertionPoint(ids, 0, 4)).toEqual(['b', 'c', 'd', 'a'])
  })

  it('moves a tab left', () => {
    expect(moveToInsertionPoint(ids, 3, 0)).toEqual(['d', 'a', 'b', 'c'])
    expect(moveToInsertionPoint(ids, 2, 1)).toEqual(['a', 'c', 'b', 'd'])
  })

  it('is a no-op when dropped either side of itself', () => {
    expect(moveToInsertionPoint(ids, 1, 1)).toEqual(ids)
    expect(moveToInsertionPoint(ids, 1, 2)).toEqual(ids)
  })

  it('ignores an out-of-range source', () => {
    expect(moveToInsertionPoint(ids, 9, 0)).toEqual(ids)
  })
})

describe('neighbourAfterClose', () => {
  it('picks the tab that slides into the closed slot', () => {
    expect(neighbourAfterClose(['a', 'b', 'c'], 'b')).toBe('c')
  })
  it('picks the new last tab when the last closes', () => {
    expect(neighbourAfterClose(['a', 'b', 'c'], 'c')).toBe('b')
  })
  it('returns null when nothing is left', () => {
    expect(neighbourAfterClose(['a'], 'a')).toBeNull()
  })
})

describe('parseTabDragPayload', () => {
  it('parses a payload', () => {
    expect(parseTabDragPayload(JSON.stringify({ token: 't', projectId: 'p', fromWindowId: 'w' }))).toEqual({
      token: 't',
      projectId: 'p',
      fromWindowId: 'w',
    })
  })
  it('rejects junk', () => {
    expect(parseTabDragPayload('nope')).toBeNull()
    expect(parseTabDragPayload(JSON.stringify({ token: 1 }))).toBeNull()
  })
})
