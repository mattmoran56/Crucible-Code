/** Longest auto-generated session name, in characters. */
export const MAX_AUTO_SESSION_NAME = 40

/**
 * Turn a model's suggested session name into one `renameSession` accepts:
 * lowercase words joined by hyphens, at most five words and
 * MAX_AUTO_SESSION_NAME characters. Null when nothing usable is left.
 */
export function toSessionName(raw: string): string | null {
  const firstLine = raw.trim().split('\n')[0] ?? ''
  const words = firstLine
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .slice(0, 5)
  let name = ''
  for (const word of words) {
    const next = name ? `${name}-${word}` : word
    if (next.length > MAX_AUTO_SESSION_NAME) break
    name = next
  }
  return name || null
}

/** `name`, or `name-2`, `name-3`… — the first one no other session uses. */
export function uniqueSessionName(name: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  if (!used.has(name)) return name
  let n = 2
  while (used.has(`${name}-${n}`)) n++
  return `${name}-${n}`
}
