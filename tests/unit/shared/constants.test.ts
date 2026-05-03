import { describe, expect, it } from 'vitest'
import { IPC } from '../../../src/shared/constants'

describe('IPC channel constants', () => {
  it('every value is unique (no duplicate channel names)', () => {
    const values = Object.values(IPC)
    expect(new Set(values).size).toBe(values.length)
  })

  it('every value is a non-empty string with at least one ":" separator', () => {
    for (const v of Object.values(IPC)) {
      expect(typeof v).toBe('string')
      expect(v.length).toBeGreaterThan(0)
      expect(v).toContain(':')
    }
  })

  it('exposes a few well-known channels', () => {
    expect(IPC.GIT_STATUS).toBe('git:status')
    expect(IPC.PR_LIST).toBe('pr:list')
    expect(IPC.NOTIFICATION_SET_BADGE).toBe('notification:set-badge')
  })

  it('groups by namespace consistently', () => {
    expect(IPC.GIT_LOG.startsWith('git:')).toBe(true)
    expect(IPC.PR_DIFF.startsWith('pr:')).toBe(true)
    expect(IPC.NOTES_LIST.startsWith('notes:')).toBe(true)
    expect(IPC.USAGE_GET_STATS.startsWith('usage:')).toBe(true)
  })
})
