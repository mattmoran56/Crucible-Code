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

describe('cn — tailwind-merge conflict resolution', () => {
  it('keeps a later axis-specific override after a shorthand (p-4 px-2)', () => {
    expect(cn('p-4', 'px-2')).toBe('p-4 px-2')
  })

  it('drops an earlier axis-specific class when a later shorthand covers it (px-2 p-4)', () => {
    expect(cn('px-2', 'p-4')).toBe('p-4')
  })

  it('m-4 swallows an earlier mt-2 but not a later one', () => {
    expect(cn('mt-2', 'm-4')).toBe('m-4')
    expect(cn('m-4', 'mt-2')).toBe('m-4 mt-2')
  })

  it('does not conflate font-size and text-color utilities', () => {
    expect(cn('text-sm', 'text-red-500')).toBe('text-sm text-red-500')
  })

  it('font-size conflicts resolve to the last one even across other classes', () => {
    expect(cn('text-base font-bold text-lg')).toBe('font-bold text-lg')
  })

  it('arbitrary values participate in conflicts both ways', () => {
    expect(cn('p-[2px]', 'p-4')).toBe('p-4')
    expect(cn('p-4', 'p-[2px]')).toBe('p-[2px]')
  })

  it('arbitrary color values beat earlier palette colors', () => {
    expect(cn('bg-red-500', 'bg-[#123456]')).toBe('bg-[#123456]')
  })

  it('merges within the same variant only', () => {
    expect(cn('hover:p-2', 'hover:p-4')).toBe('hover:p-4')
    expect(cn('hover:p-2', 'p-4')).toBe('hover:p-2 p-4')
  })

  it('merges within the same breakpoint only', () => {
    expect(cn('md:p-2', 'md:p-4')).toBe('md:p-4')
    expect(cn('sm:p-2', 'md:p-4')).toBe('sm:p-2 md:p-4')
  })

  it('dark-mode variants merge independently of the base class', () => {
    expect(cn('dark:text-white', 'text-black')).toBe('dark:text-white text-black')
    expect(cn('dark:text-white', 'dark:text-black')).toBe('dark:text-black')
  })

  it('important-prefixed utilities conflict among themselves', () => {
    expect(cn('!p-2', '!p-4')).toBe('!p-4')
  })

  it('display utilities conflict (flex vs block)', () => {
    expect(cn('flex', 'block')).toBe('block')
  })

  it('inset-0 swallows an earlier top-1 but keeps a later one', () => {
    expect(cn('top-1', 'inset-0')).toBe('inset-0')
    expect(cn('inset-0', 'top-1')).toBe('inset-0 top-1')
  })

  it('opacity-suffixed colors conflict with plain colors', () => {
    expect(cn('text-red-500/50', 'text-blue-500')).toBe('text-blue-500')
  })

  it('border width and border color coexist', () => {
    expect(cn('border', 'border-red-500')).toBe('border border-red-500')
  })

  it('negative and positive margins conflict', () => {
    expect(cn('-m-2', 'm-4')).toBe('m-4')
    expect(cn('m-4', '-m-2')).toBe('-m-2')
  })

  it('rounded shorthand conflicts with sized rounded', () => {
    expect(cn('rounded', 'rounded-lg')).toBe('rounded-lg')
  })

  it('sizing utilities conflict per axis', () => {
    expect(cn('w-4', 'w-8')).toBe('w-8')
    expect(cn('w-4', 'h-8')).toBe('w-4 h-8')
  })
})

describe('cn — clsx input shapes', () => {
  it('renders numeric inputs as strings (clsx behavior)', () => {
    expect(cn(42)).toBe('42')
    expect(cn(0)).toBe('')
  })

  it('mixes objects and nested arrays', () => {
    expect(cn({ a: 1, b: 0 }, ['c', { d: true }])).toBe('a c d')
  })

  it('normalizes stray whitespace from inputs', () => {
    expect(cn(' foo ', 'bar')).toBe('foo bar')
  })

  it('keeps duplicate non-tailwind classes (twMerge only resolves tailwind conflicts)', () => {
    expect(cn('foo foo')).toBe('foo foo')
  })

  it('keeps unknown custom classes alongside merged tailwind ones', () => {
    expect(cn('btn-primary p-2', 'p-4')).toBe('btn-primary p-4')
  })

  it('handles a deeply nested mixed structure', () => {
    expect(
      cn('base', [false, ['x', { y: true, z: false }], [[ 'p-1', 'p-2' ]]], { last: true }),
    ).toBe('base x y p-2 last')
  })

  it('handles a large number of classes without conflict loss', () => {
    const many = Array.from({ length: 200 }, (_, i) => `c${i}`)
    const result = cn(...many, 'p-1', 'p-9')
    expect(result.endsWith('p-9')).toBe(true)
    expect(result).not.toContain('p-1')
    expect(result).toContain('c0')
    expect(result).toContain('c199')
  })

  it('unicode class names pass through untouched', () => {
    expect(cn('クラス', 'p-2')).toBe('クラス p-2')
  })
})
