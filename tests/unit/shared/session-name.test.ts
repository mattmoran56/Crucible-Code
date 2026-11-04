import { describe, expect, it } from 'vitest'
import { MAX_AUTO_SESSION_NAME, toSessionName, uniqueSessionName } from '../../../src/shared/session-name'

describe('toSessionName', () => {
  it('keeps a clean spaced reply', () => {
    expect(toSessionName('Fix login redirect')).toBe('Fix login redirect')
  })

  it('turns a kebab-case reply into spaced words', () => {
    expect(toSessionName('fix-login-redirect')).toBe('Fix login redirect')
  })

  it('lowercases, drops quotes and punctuation, and joins words with spaces', () => {
    expect(toSessionName('"Review PR #42."')).toBe('Review pr 42')
    expect(toSessionName('Update_README docs!')).toBe('Update readme docs')
  })

  it('reads only the first line', () => {
    expect(toSessionName('triage-ci\nThis name fits because…')).toBe('Triage ci')
  })

  it('caps the words and the length', () => {
    expect(toSessionName('one two three four five six seven')).toBe('One two three four five')
    const long = toSessionName('a'.repeat(30) + ' ' + 'b'.repeat(30))!
    expect(long).toBe('A' + 'a'.repeat(29))
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
    expect(uniqueSessionName('Fix bug', ['Fix bug', 'Fix bug 2'])).toBe('Fix bug 3')
  })
})
