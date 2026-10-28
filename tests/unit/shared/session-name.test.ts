import { describe, expect, it } from 'vitest'
import { MAX_AUTO_SESSION_NAME, toSessionName, uniqueSessionName } from '../../../src/shared/session-name'

describe('toSessionName', () => {
  it('keeps a clean kebab-case reply', () => {
    expect(toSessionName('fix-login-redirect')).toBe('fix-login-redirect')
  })

  it('lowercases, drops quotes and punctuation, and joins words with hyphens', () => {
    expect(toSessionName('"Review PR #42."')).toBe('review-pr-42')
    expect(toSessionName('Update_README docs!')).toBe('update-readme-docs')
  })

  it('reads only the first line', () => {
    expect(toSessionName('triage-ci\nThis name fits because…')).toBe('triage-ci')
  })

  it('caps the words and the length', () => {
    expect(toSessionName('one two three four five six seven')).toBe('one-two-three-four-five')
    const long = toSessionName('a'.repeat(30) + ' ' + 'b'.repeat(30))!
    expect(long).toBe('a'.repeat(30))
    expect(long.length).toBeLessThanOrEqual(MAX_AUTO_SESSION_NAME)
  })

  it('returns null when nothing usable is left', () => {
    expect(toSessionName('')).toBeNull()
    expect(toSessionName('  …  ')).toBeNull()
  })
})

describe('uniqueSessionName', () => {
  it('suffixes the first free number', () => {
    expect(uniqueSessionName('fix', [])).toBe('fix')
    expect(uniqueSessionName('fix', ['fix', 'fix-2'])).toBe('fix-3')
  })
})
