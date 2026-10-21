// Slash commands the composer offers, and the pure judgements around them:
// when the menu is open, what matches, and what a sent draft means.

export interface SlashCommand {
  name: string
  description: string
  /** Shown after the name in the menu, e.g. "<question>". */
  args?: string
  /** `panel` commands are handled here and never sent to the session. */
  handledBy: 'panel' | 'session'
}

export const BUILTIN_COMMANDS: SlashCommand[] = [
  { name: '/btw', args: '<question>', description: 'Ask a side question in a fork — the conversation is untouched', handledBy: 'panel' },
  { name: '/compact', args: '[instructions]', description: 'Summarise the conversation so far to free up context', handledBy: 'session' },
  { name: '/clear', description: 'Start a fresh conversation (ends this Claude session)', handledBy: 'panel' },
  { name: '/model', description: 'Switch the model for the next turn', handledBy: 'panel' },
  { name: '/init', description: 'Write a CLAUDE.md describing this codebase', handledBy: 'session' },
  { name: '/review', description: 'Review the current changes', handledBy: 'session' },
  { name: '/security-review', description: 'Security review of the pending changes', handledBy: 'session' },
  { name: '/cost', description: 'Show what this session has cost so far', handledBy: 'session' },
]

/** The query the menu should match, or null when the menu should be closed. */
export const commandQuery = (draft: string): string | null => {
  if (!draft.startsWith('/')) return null
  if (/\s/.test(draft)) return null
  return draft
}

const bare = (name: string): string => name.replace(/^\//, '').toLowerCase()

const subsequence = (needle: string, haystack: string): boolean => {
  if (!needle) return true
  let at = 0
  for (const character of haystack) {
    if (character === needle[at]) at += 1
    if (at === needle.length) return true
  }
  return false
}

/** Commands matching a query: exact, then prefix, then subsequence; stable within a band. */
export const matchCommands = (commands: readonly SlashCommand[], query: string): SlashCommand[] => {
  const needle = bare(query)
  if (!needle) return [...commands]
  const scored: { command: SlashCommand; band: number; at: number }[] = []
  commands.forEach((command, at) => {
    const name = bare(command.name)
    if (!subsequence(needle, name)) return
    scored.push({ command, band: name === needle ? 0 : name.startsWith(needle) ? 1 : 2, at })
  })
  scored.sort((a, b) => a.band - b.band || a.at - b.at)
  return scored.map((held) => held.command)
}

/** What sending a draft should do. */
export type DraftIntent =
  | { kind: 'send'; text: string }
  | { kind: 'fork'; question: string }
  | { kind: 'clear' }
  | { kind: 'model' }
  | { kind: 'empty' }
  | { kind: 'invalid'; message: string }

export const intentOf = (draft: string): DraftIntent => {
  const text = draft.trim()
  if (!text) return { kind: 'empty' }
  const [first, ...rest] = text.split(/\s+/)
  const head = first.toLowerCase()
  const tail = text.slice(first.length).trim()
  if (head === '/btw') {
    return rest.length ? { kind: 'fork', question: tail } : { kind: 'invalid', message: 'Type a question after /btw' }
  }
  if (head === '/clear') return { kind: 'clear' }
  if (head === '/model') return { kind: 'model' }
  return { kind: 'send', text: draft }
}
