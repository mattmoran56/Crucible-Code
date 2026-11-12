// Turns an assistant message (Markdown, as Claude writes it) into plain text a
// text-to-speech voice can read. Audio mode asks Claude not to write Markdown
// at all; this is the defence in depth for when it slips. Pure.

export type CodeBlockSpeech = 'skip' | 'announce'

export interface SpeakableOptions {
  /** Fenced code blocks: dropped silently, or replaced by "Code block omitted." */
  codeBlocks?: CodeBlockSpeech
}

export const CODE_BLOCK_OMITTED = 'Code block omitted.'

const FENCE_OPEN = /^[ \t]{0,3}(`{3,}|~{3,})[^\n]*$/

/** Drop fenced code blocks (closed or not), line by line so nested backticks don't confuse it. */
function stripFences(text: string, announce: boolean): string {
  const out: string[] = []
  const lines = text.split('\n')
  let fence: string | null = null
  for (const line of lines) {
    if (fence === null) {
      const open = FENCE_OPEN.exec(line)
      if (open) {
        fence = open[1]
        // Blank lines keep the announcement its own sentence.
        out.push('', announce ? CODE_BLOCK_OMITTED : '', '')
        continue
      }
      out.push(line)
    } else {
      const close = new RegExp(`^[ \\t]{0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}[ \\t]*$`)
      if (close.test(line)) fence = null
    }
  }
  return out.join('\n')
}

const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/
/** A table row: starts or ends with a pipe and has at least two of them. */
const isTableRow = (line: string): boolean => {
  const t = line.trim()
  if (TABLE_SEPARATOR.test(t) && t.includes('-') && (t.includes('|') || /^-{2,}\s*\|/.test(t))) return true
  return (t.startsWith('|') || t.endsWith('|')) && (t.match(/\|/g)?.length ?? 0) >= 2
}

/** "https://www.github.com/a/b" → "github.com"; anything unparseable → "a link". */
export function urlToSpeech(raw: string): string {
  try {
    const url = new URL(raw.startsWith('www.') ? `https://${raw}` : raw)
    const host = url.hostname.replace(/^www\./, '')
    if (!host) return 'a link'
    if (/^(localhost|\d+\.\d+\.\d+\.\d+)$/.test(host)) return url.port ? `localhost port ${url.port}` : 'a local link'
    return host
  } catch {
    return 'a link'
  }
}

const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>()[\]"'`]+[^\s<>()[\]"'`.,;:!?]/gi

/** A path-shaped token: rooted, or two or more slashes, or one slash ending in a file name. */
const PATH_PATTERN =
  /(?<![\w@])(?:~|\.{1,2})?(?:[\\/][\w.@+-]+){1,}[\\/]?|(?<![\w@/\\])[\w.@+-]+(?:[\\/][\w.@+-]+)+[\\/]?/g

const looksLikePath = (token: string): boolean => {
  const slashes = (token.match(/[\\/]/g) ?? []).length
  if (/^(~|\.{1,2})?[\\/]/.test(token) && slashes >= 1 && /[A-Za-z]/.test(token)) {
    // A lone "/" word or "/2" (a fraction) is not a path.
    return token.replace(/[\\/]/g, '').length > 1 && !/^[\\/]\d+$/.test(token)
  }
  if (slashes >= 2) return !/^\d+[\\/]\d+[\\/]\d+$/.test(token) // not a date
  // One slash: only with a file extension on the end ("src/app.ts", not "and/or").
  return slashes === 1 && /[\\/][\w@+-]+\.[A-Za-z][\w]{0,7}$/.test(token)
}

/** The last segment of a path, or the last folder name for one ending in a slash. */
export function pathToSpeech(path: string): string {
  const parts = path.split(/[\\/]/).filter((p) => p && p !== '.' && p !== '..' && p !== '~')
  return parts[parts.length - 1] ?? path
}

function shortenPaths(text: string): string {
  return text
    .replace(/(^|[\s(])([A-Za-z]:\\(?:[^\\\s]+\\)*[^\\\s]+)/g, (_m, pre: string, p: string) => `${pre}${pathToSpeech(p)}`)
    .replace(PATH_PATTERN, (match) => {
      // A sentence's full stop is not part of the path.
      const token = match.replace(/\.+$/, '')
      const tail = match.slice(token.length)
      return looksLikePath(token) ? pathToSpeech(token) + tail : match
    })
}

// Emoji and pictographs, with the joiners, variation selectors, skin tones,
// keycaps and flag letters that build them.
const EMOJI =
  /(?:\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]|[\u{1F3FB}-\u{1F3FF}]|\u{FE0F}|\u{FE0E}|\u{200D}|\u{20E3})/gu

const HASH = /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,64}\b/g

function inlineMarkdown(line: string): string {
  return (
    line
      // Images keep their alt text, links their text.
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\(([^)\s]*)[^)]*\)/g, (_m, label: string, href: string) =>
        /^(?:https?:\/\/|www\.)/i.test(label.trim()) || label.trim() === href ? urlToSpeech(href) : label,
      )
      .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
      // Autolinks.
      .replace(/<((?:https?:\/\/|www\.)[^>\s]+)>/gi, (_m, href: string) => urlToSpeech(href))
      // Inline code: keep what it says, but not a wall of it.
      .replace(/(`+)([^`]+?)\1/g, (_m, _ticks: string, code: string) => {
        const c = code.trim()
        if (/^(?:https?:\/\/|www\.)/i.test(c)) return urlToSpeech(c)
        if (looksLikePath(c)) return pathToSpeech(c)
        return c.length > 48 ? 'a code snippet' : c
      })
      // Emphasis and strikethrough, paired.
      .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2')
      .replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?!\w)/g, '$1$2')
      .replace(/(^|[^\w_])_(?=\S)([^_\n]*?\S)_(?!\w)/g, '$1$2')
      .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '$1')
      // HTML tags (<br>, <details>, …); a "<" not followed by a letter is maths.
      .replace(/<\/?[A-Za-z][^>]*>/g, ' ')
  )
}

/** End a line that stands on its own (heading, list item) with a full stop so the voice pauses. */
const endSentence = (s: string): string => {
  const t = s.trimEnd()
  if (!t) return t
  return /[.!?:;…]["'”’)\]]*$/.test(t) ? t : `${t}.`
}

const HEADING = /^[ \t]{0,3}#{1,6}[ \t]+(.*?)[ \t#]*$/
const LIST_ITEM = /^[ \t]*(?:[-*+•]|\d{1,3}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?(.*)$/
const QUOTE = /^[ \t]*(?:>[ \t]?)+/
const RULE = /^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const REF_DEF = /^[ \t]{0,3}\[[^\]]+\]:[ \t]*\S+.*$/

/**
 * Plain, speakable text from an assistant message: Markdown syntax stripped,
 * fenced code removed (or announced), tables dropped, URLs shortened to their
 * domain, long paths to their file name, emoji removed. Whitespace is
 * collapsed; paragraphs come back separated by a blank line.
 */
export function toSpeakableText(markdown: string, options: SpeakableOptions = {}): string {
  if (!markdown) return ''
  const announce = options.codeBlocks === 'announce'
  const text = stripFences(markdown.replace(/\r\n?/g, '\n'), announce)

  const lines: string[] = []
  for (const raw of text.split('\n')) {
    let line = raw.replace(QUOTE, '')
    if (RULE.test(line) || REF_DEF.test(line) || isTableRow(line)) {
      lines.push('')
      continue
    }
    const heading = HEADING.exec(line)
    const item = heading ? null : LIST_ITEM.exec(line)
    if (heading) line = heading[1]
    else if (item) line = item[1]

    line = inlineMarkdown(line)
    line = line.replace(URL_PATTERN, (url) => urlToSpeech(url))
    line = shortenPaths(line)
    line = line.replace(/(\b[\w-]+\.[A-Za-z]{1,8}):(\d+)(?::\d+)?\b/g, '$1 line $2')
    line = line.replace(HASH, 'a hash')
    line = line.replace(EMOJI, '')
    // Stray markers a cut-off or unbalanced span leaves behind.
    line = line.replace(/(\d)\s*[*×]\s*(?=\d)/g, '$1 times ')
    line = line.replace(/\*\*|__|~~|`/g, '').replace(/(^|\s)[*_#]+(?=\s|$)/g, '$1')
    line = line
      .replace(/\s*(?:->|→|⟶)\s*/g, ' to ')
      .replace(/\s*(?:<-|←)\s*/g, ' from ')
      .replace(/\s+&\s+/g, ' and ')
      .replace(/[ \t]+/g, ' ')
      .trim()
    if (!line || /^[\p{P}\p{S}\s]+$/u.test(line)) {
      lines.push('')
      continue
    }
    lines.push(heading || item ? endSentence(line) : line)
  }

  // Lines within a paragraph join with a space; blank lines separate paragraphs.
  const paragraphs: string[] = []
  let current: string[] = []
  for (const line of lines) {
    if (line) current.push(line)
    else if (current.length) {
      paragraphs.push(current.join(' '))
      current = []
    }
  }
  if (current.length) paragraphs.push(current.join(' '))
  return paragraphs
    .map((p) => p.replace(/\s+([,.;:!?])/g, '$1').replace(/\s{2,}/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n')
}
