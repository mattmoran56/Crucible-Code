import { describe, expect, it } from 'vitest'
import { cn } from '../../../src/renderer/lib/cn'

describe('cn', () => {
  it('joins string classes', () => {
    expect(cn('foo', 'bar')).toBe('foo bar')
  })

  it('drops falsy values', () => {
    expect(cn('foo', false, null, undefined, '', 'bar')).toBe('foo bar')
  })

  it('handles conditional objects', () => {
    expect(cn('base', { active: true, disabled: false })).toBe('base active')
  })

  it('flattens nested arrays', () => {
    expect(cn(['a', ['b', { c: true }]])).toBe('a b c')
  })

  it('merges conflicting tailwind classes (last one wins)', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4')
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500')
  })

  it('returns empty string when no inputs are truthy', () => {
    expect(cn(false, null, undefined)).toBe('')
  })
})
