import { describe, expect, it } from 'vitest'
import {
  isAuthorMine,
  normalizePrefix,
} from '../../../src/main/services/claudeWebSessions.service'

describe('isAuthorMine', () => {
  it('matches when the author email equals the configured git email', () => {
    expect(isAuthorMine('matt@example.com', 'matt@example.com', null)).toBe(true)
  })

  it('matches case-insensitively', () => {
    expect(isAuthorMine('Matt@Example.COM', 'matt@example.com', null)).toBe(true)
  })

  it('matches the GitHub noreply pattern against the GitHub login', () => {
    expect(
      isAuthorMine('12345+mattmoran@users.noreply.github.com', null, 'mattmoran')
    ).toBe(true)
  })

  it('matches noreply case-insensitively', () => {
    expect(
      isAuthorMine('12345+MATTMORAN@users.noreply.github.com', null, 'mattmoran')
    ).toBe(true)
  })

  it('does not match a noreply with a different login', () => {
    expect(
      isAuthorMine('99+colleague@users.noreply.github.com', null, 'mattmoran')
    ).toBe(false)
  })

  it('does not match when neither email nor login matches', () => {
    expect(
      isAuthorMine('someone-else@example.com', 'matt@example.com', 'mattmoran')
    ).toBe(false)
  })

  it('returns false for an empty author email', () => {
    expect(isAuthorMine('', 'matt@example.com', 'mattmoran')).toBe(false)
  })

  it('returns false when both identities are missing', () => {
    expect(isAuthorMine('matt@example.com', null, null)).toBe(false)
  })

  it('does not match a plain noreply (no id+login prefix)', () => {
    expect(
      isAuthorMine('noreply@github.com', null, 'mattmoran')
    ).toBe(false)
  })
})

describe('normalizePrefix', () => {
  it('defaults to claude/ when undefined', () => {
    expect(normalizePrefix(undefined)).toBe('claude/')
  })

  it('defaults to claude/ when empty string', () => {
    expect(normalizePrefix('')).toBe('claude/')
  })

  it('defaults to claude/ when whitespace-only', () => {
    expect(normalizePrefix('   ')).toBe('claude/')
  })

  it('appends a trailing slash if missing', () => {
    expect(normalizePrefix('bot/claude')).toBe('bot/claude/')
  })

  it('preserves an existing trailing slash', () => {
    expect(normalizePrefix('bot/claude/')).toBe('bot/claude/')
  })

  it('strips a leading refs/heads/ prefix', () => {
    expect(normalizePrefix('refs/heads/claude/')).toBe('claude/')
  })

  it('strips refs/heads/ and adds trailing slash together', () => {
    expect(normalizePrefix('refs/heads/bot')).toBe('bot/')
  })
})
