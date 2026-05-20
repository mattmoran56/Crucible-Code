import { describe, expect, it } from 'vitest'
import {
  normalizeDatabaseId,
  resolvePlaceholders,
  slugify,
  valueReferencesSessionPlaceholder,
} from '../../../src/main/services/notion.service'

describe('notion.service / placeholder helpers', () => {
  describe('resolvePlaceholders', () => {
    it('substitutes every known placeholder', () => {
      const out = resolvePlaceholders(
        'task={{taskId}} url={{taskUrl}} t={{taskTitle}} s={{taskTitleSlug}} b={{branch}} sid={{sessionId}}',
        {
          taskId: 'abc',
          taskUrl: 'https://notion.so/abc',
          taskTitle: 'Hello World',
          taskTitleSlug: 'hello-world',
          branch: 'notion/hello-world',
          sessionId: 'sess-1',
        }
      )
      expect(out).toBe(
        'task=abc url=https://notion.so/abc t=Hello World s=hello-world b=notion/hello-world sid=sess-1'
      )
    })

    it('derives taskTitleSlug from taskTitle when not provided', () => {
      expect(resolvePlaceholders('{{taskTitleSlug}}', { taskTitle: 'Fix the Bug!' })).toBe(
        'fix-the-bug'
      )
    })

    it('replaces unknown placeholder context values with empty string', () => {
      expect(resolvePlaceholders('b={{branch}} s={{sessionId}}', { taskId: 'x' })).toBe('b= s=')
    })

    it('leaves non-placeholder braces alone', () => {
      expect(resolvePlaceholders('{not-a-placeholder} {{nope}}', { taskId: 'x' })).toBe(
        '{not-a-placeholder} {{nope}}'
      )
    })
  })

  describe('slugify', () => {
    it('lowercases and collapses non-alphanumeric runs', () => {
      expect(slugify('Hello, World!  Foo')).toBe('hello-world-foo')
    })

    it('trims leading/trailing dashes', () => {
      expect(slugify('---abc---')).toBe('abc')
    })

    it('caps length at 60', () => {
      expect(slugify('a'.repeat(80)).length).toBe(60)
    })
  })

  describe('valueReferencesSessionPlaceholder', () => {
    it('returns true for {{branch}}', () => {
      expect(valueReferencesSessionPlaceholder('foo {{branch}} bar')).toBe(true)
    })

    it('returns true for {{sessionId}}', () => {
      expect(valueReferencesSessionPlaceholder('foo {{sessionId}}')).toBe(true)
    })

    it('returns false for non-session placeholders', () => {
      expect(valueReferencesSessionPlaceholder('foo {{taskUrl}}')).toBe(false)
      expect(valueReferencesSessionPlaceholder('foo bar')).toBe(false)
    })
  })

  describe('normalizeDatabaseId', () => {
    it('returns a bare id untouched', () => {
      expect(normalizeDatabaseId('1234567890abcdef1234567890abcdef')).toBe(
        '1234567890abcdef1234567890abcdef'
      )
    })

    it('strips a Notion URL down to the trailing id', () => {
      const url = 'https://www.notion.so/workspace/My-DB-1234567890abcdef1234567890abcdef'
      expect(normalizeDatabaseId(url)).toBe('1234567890abcdef1234567890abcdef')
    })

    it('strips query strings', () => {
      const url = 'https://notion.so/workspace/My-DB-1234567890abcdef1234567890abcdef?v=foo'
      expect(normalizeDatabaseId(url)).toBe('1234567890abcdef1234567890abcdef')
    })

    it('trims whitespace', () => {
      expect(normalizeDatabaseId('  abc123  ')).toBe('abc123')
    })
  })
})
