import { describe, expect, it } from 'vitest'
import { neighbourAfterClose } from '../../../src/renderer/lib/tabOrder'

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
