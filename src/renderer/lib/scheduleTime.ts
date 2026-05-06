import type { SessionUsage } from '../../shared/types'

/**
 * Pick the earliest 5-hour reset across all sessions, in epoch ms. Returns
 * null if no session has reported a reset time. Used to pre-fill the
 * "Schedule for later" picker and the auto-continue toast.
 */
export function nextResetEpochMs(usages: SessionUsage[]): number | null {
  let earliest: number | null = null
  for (const u of usages) {
    const r = u.rateLimits?.fiveHour?.resetsAt
    if (!r) continue
    const ms = r * 1000
    if (ms < Date.now()) continue
    if (earliest == null || ms < earliest) earliest = ms
  }
  return earliest
}

/**
 * Convert epoch ms → the value an `<input type="datetime-local">` expects:
 * a local-timezone string like "2026-05-04T17:30". The browser does NOT
 * accept a UTC ISO string here.
 */
export function toLocalDateTimeInputValue(epochMs: number): string {
  const d = new Date(epochMs)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * Inverse of toLocalDateTimeInputValue. The Date constructor parses
 * "YYYY-MM-DDTHH:mm" as local time, which is what we want.
 */
export function fromLocalDateTimeInputValue(value: string): number | null {
  if (!value) return null
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : null
}

/**
 * Human-readable "in 23m" / "in 4h 12m" / "now" used by scheduled-session
 * cards and the queued-message chip. Returns "now" for anything within ±60s.
 */
export function formatRelativeUntil(epochMs: number, now: number = Date.now()): string {
  const diff = epochMs - now
  const abs = Math.abs(diff)
  if (abs < 60_000) return 'now'
  const minutes = Math.round(abs / 60_000)
  if (minutes < 60) return diff < 0 ? `${minutes}m ago` : `in ${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remMin = minutes % 60
  const tail = remMin === 0 ? `${hours}h` : `${hours}h ${remMin}m`
  return diff < 0 ? `${tail} ago` : `in ${tail}`
}

/**
 * "5:32 PM" — used as the secondary absolute-time label.
 */
export function formatClockTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}
