// Patterns that indicate Claude Code (or other CLI tools) need user intervention
export const INTERVENTION_PATTERNS = [
  /Do you want to proceed\?/i,
  /\(y\/n\)/i,
  /\[Y\/n\]/,
  /\[yes\/no\]/i,
  /Are you sure\?/i,
  /Press Enter to continue/i,
  /Allow once|Allow always|Deny/,
  /Do you want to allow/i,
]

/**
 * Which usage window Claude reported as exhausted. `generic` is anything we
 * recognise as a real limit hit without being able to tell which window it was
 * (e.g. the headless `claude -p` banner).
 */
export type UsageLimitKind = 'session' | 'weekly' | 'opus' | 'generic'

export interface UsageLimitDetection {
  kind: UsageLimitKind
  /** Reset time in unix seconds — only present when the banner carries it inline. */
  resetsAt?: number
}

// CSI / common ANSI escape sequences. Claude wraps its limit banner in styling
// and box-drawing, so we strip these before substring-matching the wording.
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g

/**
 * Detect the genuine, conversation-breaking "you have hit your usage limit"
 * banner in a chunk of (possibly ANSI-styled) Claude terminal output.
 *
 * Returns null for anything that is NOT a hard stop — including the
 * "Server is temporarily limiting requests (not your usage limit)" throttle,
 * 429 capacity errors, and the always-on usage progress bars. We only fire on
 * the message that actually blocks the session, never on a percentage.
 */
export function detectUsageLimit(raw: string): UsageLimitDetection | null {
  const text = raw.replace(ANSI_RE, '')

  // Headless / print mode carries the reset timestamp inline:
  //   "Claude AI usage limit reached|1760000400"
  const pipe = /usage limit reached\s*\|\s*(\d{10})\b/i.exec(text)
  if (pipe) return { kind: 'generic', resetsAt: Number(pipe[1]) }

  // Interactive block banner, e.g.:
  //   "You've hit your session limit · resets 3:45pm"
  //   "You've hit your weekly limit · resets Mon 12:00am"
  const hit = /hit your (session|weekly|opus|usage) limit/i.exec(text)
  if (hit) {
    const word = hit[1].toLowerCase()
    const kind: UsageLimitKind = word === 'usage' ? 'generic' : (word as UsageLimitKind)
    return { kind }
  }

  // Older / generic phrasings:
  //   "Claude usage limit reached. Your limit will reset at 2pm (...)"
  if (/usage limit reached/i.test(text)) return { kind: 'generic' }

  return null
}
