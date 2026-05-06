import { describe, expect, it } from 'vitest'
import {
  nextResetEpochMs,
  toLocalDateTimeInputValue,
  fromLocalDateTimeInputValue,
  formatRelativeUntil,
  formatClockTime,
} from '../../../src/renderer/lib/scheduleTime'
import type { SessionUsage } from '../../../src/shared/types'

const usage = (sessionId: string, fiveHourResetsAt?: number): SessionUsage => ({
  sessionId,
  cost: { totalCostUsd: 0, totalDurationMs: 0, totalApiDurationMs: 0, totalLinesAdded: 0, totalLinesRemoved: 0 },
  updatedAt: 0,
  rateLimits: fiveHourResetsAt
    ? { fiveHour: { usedPercentage: 0, resetsAt: fiveHourResetsAt } }
    : undefined,
})

describe('nextResetEpochMs', () => {
  it('returns null when no sessions have a reset time', () => {
    expect(nextResetEpochMs([])).toBeNull()
    expect(nextResetEpochMs([usage('a')])).toBeNull()
  })

  it('picks the earliest future reset across sessions', () => {
    const now = Date.now()
    const earliest = Math.floor((now + 60_000) / 1000)
    const later = Math.floor((now + 120_000) / 1000)
    const result = nextResetEpochMs([usage('a', later), usage('b', earliest)])
    expect(result).toBe(earliest * 1000)
  })

  it('ignores resets in the past', () => {
    const now = Date.now()
    const past = Math.floor((now - 60_000) / 1000)
    const future = Math.floor((now + 60_000) / 1000)
    expect(nextResetEpochMs([usage('a', past), usage('b', future)])).toBe(future * 1000)
  })
})

describe('datetime-local round-trip', () => {
  it('round-trips a local time without drift', () => {
    const date = new Date(2026, 4, 5, 17, 30, 0, 0).getTime()
    const value = toLocalDateTimeInputValue(date)
    expect(value).toBe('2026-05-05T17:30')
    expect(fromLocalDateTimeInputValue(value)).toBe(date)
  })

  it('returns null for an empty input', () => {
    expect(fromLocalDateTimeInputValue('')).toBeNull()
  })
})

describe('formatRelativeUntil', () => {
  it('returns "now" within ±60s', () => {
    expect(formatRelativeUntil(1_000_000, 1_000_000)).toBe('now')
    expect(formatRelativeUntil(1_000_000 + 30_000, 1_000_000)).toBe('now')
    expect(formatRelativeUntil(1_000_000 - 30_000, 1_000_000)).toBe('now')
  })

  it('formats sub-hour future as "in Nm"', () => {
    expect(formatRelativeUntil(1_000_000 + 5 * 60_000, 1_000_000)).toBe('in 5m')
  })

  it('formats sub-hour past as "Nm ago"', () => {
    expect(formatRelativeUntil(1_000_000 - 5 * 60_000, 1_000_000)).toBe('5m ago')
  })

  it('formats 4h 12m future correctly', () => {
    expect(formatRelativeUntil(1_000_000 + (4 * 60 + 12) * 60_000, 1_000_000)).toBe('in 4h 12m')
  })

  it('drops zero minutes from the hour formatting', () => {
    expect(formatRelativeUntil(1_000_000 + 4 * 60 * 60_000, 1_000_000)).toBe('in 4h')
  })
})

describe('formatClockTime', () => {
  it('formats a date as a short clock time', () => {
    const result = formatClockTime(new Date(2026, 4, 5, 17, 30).getTime())
    // Locale-dependent, but must contain digits and AM/PM or 24h notation.
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(2)
  })
})
