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

describe('nextResetEpochMs — boundaries (fake clock)', () => {
  const NOW = new Date(2026, 5, 10, 12, 0, 0, 0).getTime()

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  it('a reset exactly at "now" is treated as future and returned', () => {
    const atNow = NOW / 1000 // NOW is built from whole seconds
    expect(nextResetEpochMs([usage('a', atNow)])).toBe(NOW)
  })

  it('a reset one second in the past is ignored', () => {
    expect(nextResetEpochMs([usage('a', NOW / 1000 - 1)])).toBeNull()
  })

  it('a resetsAt of 0 is treated as missing (falsy guard)', () => {
    const zeroReset: SessionUsage = {
      ...usage('a'),
      rateLimits: { fiveHour: { usedPercentage: 50, resetsAt: 0 } },
    }
    expect(nextResetEpochMs([zeroReset])).toBeNull()
  })

  it('returns null when every reset is in the past', () => {
    expect(
      nextResetEpochMs([usage('a', NOW / 1000 - 60), usage('b', NOW / 1000 - 3600)]),
    ).toBeNull()
  })

  it('a single future reset is returned in epoch milliseconds', () => {
    const future = NOW / 1000 + 90
    expect(nextResetEpochMs([usage('a', future)])).toBe(future * 1000)
  })

  it('ties between sessions resolve to that shared value', () => {
    const future = NOW / 1000 + 120
    expect(nextResetEpochMs([usage('a', future), usage('b', future)])).toBe(future * 1000)
  })

  it('sessions without rateLimits are skipped without affecting the result', () => {
    const future = NOW / 1000 + 300
    expect(nextResetEpochMs([usage('no-limits'), usage('b', future), usage('c')])).toBe(future * 1000)
  })

  it('only the fiveHour window counts — sevenDay alone yields null', () => {
    const sevenDayOnly: SessionUsage = {
      sessionId: 's',
      cost: { totalCostUsd: 0, totalDurationMs: 0, totalApiDurationMs: 0, totalLinesAdded: 0, totalLinesRemoved: 0 },
      updatedAt: 0,
      rateLimits: { sevenDay: { usedPercentage: 10, resetsAt: NOW / 1000 + 600 } },
    }
    expect(nextResetEpochMs([sevenDayOnly])).toBeNull()
  })

  it('earliest wins regardless of array order', () => {
    const early = NOW / 1000 + 60
    const late = NOW / 1000 + 6000
    expect(nextResetEpochMs([usage('late', late), usage('early', early)])).toBe(early * 1000)
    expect(nextResetEpochMs([usage('early', early), usage('late', late)])).toBe(early * 1000)
  })
})

describe('toLocalDateTimeInputValue — padding and truncation', () => {
  it('zero-pads single-digit month, day, hour and minute', () => {
    expect(toLocalDateTimeInputValue(new Date(2026, 0, 2, 3, 4).getTime())).toBe('2026-01-02T03:04')
  })

  it('renders midnight as T00:00', () => {
    expect(toLocalDateTimeInputValue(new Date(2026, 7, 9, 0, 0).getTime())).toBe('2026-08-09T00:00')
  })

  it('renders the last minute of the year', () => {
    expect(toLocalDateTimeInputValue(new Date(2026, 11, 31, 23, 59).getTime())).toBe('2026-12-31T23:59')
  })

  it('truncates seconds and milliseconds (no rounding up)', () => {
    expect(toLocalDateTimeInputValue(new Date(2026, 5, 10, 8, 9, 59, 999).getTime())).toBe('2026-06-10T08:09')
  })

  it.each([
    [2026, 0, 15, 6, 30],  // mid-winter
    [2026, 6, 15, 6, 30],  // mid-summer (DST differs by zone; local fields are stable)
    [2027, 1, 28, 23, 1],
    [2028, 1, 29, 12, 0],  // leap day
  ])('round-trips %i-%i-%i %i:%i through the input format', (y, m, d, h, min) => {
    const epoch = new Date(y, m, d, h, min).getTime()
    expect(fromLocalDateTimeInputValue(toLocalDateTimeInputValue(epoch))).toBe(epoch)
  })
})

describe('fromLocalDateTimeInputValue — invalid inputs', () => {
  it('rejects unparseable text', () => {
    expect(fromLocalDateTimeInputValue('garbage')).toBeNull()
  })

  it('rejects an impossible calendar date', () => {
    expect(fromLocalDateTimeInputValue('2026-13-45T99:99')).toBeNull()
  })

  it('parses the bare input format as local time', () => {
    expect(fromLocalDateTimeInputValue('2026-01-02T03:04')).toBe(new Date(2026, 0, 2, 3, 4).getTime())
  })

  it('accepts seconds when present', () => {
    expect(fromLocalDateTimeInputValue('2026-01-02T03:04:05')).toBe(
      new Date(2026, 0, 2, 3, 4, 5).getTime(),
    )
  })
})

describe('formatRelativeUntil — boundary math', () => {
  const T = 10_000_000_000

  it('59.999s ahead is still "now"', () => {
    expect(formatRelativeUntil(T + 59_999, T)).toBe('now')
  })

  it('59.999s behind is still "now"', () => {
    expect(formatRelativeUntil(T - 59_999, T)).toBe('now')
  })

  it('exactly 60s ahead becomes "in 1m"', () => {
    expect(formatRelativeUntil(T + 60_000, T)).toBe('in 1m')
  })

  it('exactly 60s behind becomes "1m ago"', () => {
    expect(formatRelativeUntil(T - 60_000, T)).toBe('1m ago')
  })

  it('90s rounds up to 2m', () => {
    expect(formatRelativeUntil(T + 90_000, T)).toBe('in 2m')
  })

  it('59m stays in minutes', () => {
    expect(formatRelativeUntil(T + 59 * 60_000, T)).toBe('in 59m')
  })

  it('59.5m rounds to 60 and flips to "in 1h"', () => {
    expect(formatRelativeUntil(T + 3_570_000, T)).toBe('in 1h')
  })

  it('89.5m rounds to "in 1h 30m"', () => {
    expect(formatRelativeUntil(T + 5_370_000, T)).toBe('in 1h 30m')
  })

  it('exact hours drop the minute tail in the past too', () => {
    expect(formatRelativeUntil(T - 2 * 3_600_000, T)).toBe('2h ago')
  })

  it('past hours keep a minute remainder', () => {
    expect(formatRelativeUntil(T - (3 * 60 + 7) * 60_000, T)).toBe('3h 7m ago')
  })

  it('does not roll hours into days — 24h+ stays in hours', () => {
    expect(formatRelativeUntil(T + 24 * 3_600_000, T)).toBe('in 24h')
    expect(formatRelativeUntil(T + 24 * 3_600_000 + 5 * 60_000, T)).toBe('in 24h 5m')
  })

  it('a week out renders as 168h', () => {
    expect(formatRelativeUntil(T + 7 * 24 * 3_600_000, T)).toBe('in 168h')
  })

  it('defaults `now` to the system clock', () => {
    vi.useFakeTimers()
    vi.setSystemTime(T)
    expect(formatRelativeUntil(T + 5 * 60_000)).toBe('in 5m')
  })
})

describe('formatClockTime — fixed local times', () => {
  it('always includes the two-digit minute', () => {
    expect(formatClockTime(new Date(2026, 4, 5, 17, 5).getTime())).toContain('05')
  })

  it('formats midnight minutes', () => {
    expect(formatClockTime(new Date(2026, 4, 5, 0, 7).getTime())).toContain('07')
  })

  it('distinct minutes produce distinct strings', () => {
    const a = formatClockTime(new Date(2026, 4, 5, 9, 14).getTime())
    const b = formatClockTime(new Date(2026, 4, 5, 9, 15).getTime())
    expect(a).not.toBe(b)
  })
})
