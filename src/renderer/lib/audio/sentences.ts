// Incremental sentence chunking for streamed assistant text. Text arrives a
// few characters at a time; the voice wants whole sentences (a sentence is
// what Kokoro reads naturally, and the first one should start playing as soon
// as it is complete). Works on the raw Markdown so it can keep a fenced code
// block in one piece and treat list items and headings as their own
// sentences; each chunk then goes through toSpeakableText. Pure.

/** A chunk this long with no sentence end is split at a clause (", ", "; ") instead. */
export const SOFT_MAX_CHARS = 220
/** …and at a space, failing that. */
export const HARD_MAX_CHARS = 400

const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'st', 'sr', 'jr', 'vs', 'etc', 'e.g', 'i.e', 'eg', 'ie', 'approx',
  'inc', 'ltd', 'co', 'no', 'fig', 'cf', 'al', 'ca', 'est', 'dept', 'min', 'max', 'misc', 'ver', 'v',
])

const FENCE_OPEN = /^[ \t]{0,3}(`{3,}|~{3,})/
const WAIT = -1
/** A line that begins its own block: list item, heading, quote, table row, fence, rule. */
const BLOCK_START = /^[ \t]*(?:[-*+•][ \t]|\d{1,3}[.)][ \t]|#{1,6}[ \t]|>|\||`{3,}|~{3,}|[-*_]{3,}[ \t]*$)/

const isBlockLine = (line: string): boolean => BLOCK_START.test(line)

/** The word right before a full stop at `dot`, lower-cased ("e.g" for "e.g."). */
function wordBefore(text: string, dot: number): string {
  let i = dot - 1
  while (i >= 0 && /[A-Za-z.]/.test(text[i])) i--
  return text.slice(i + 1, dot).toLowerCase()
}

export class SentenceChunker {
  private buf = ''

  /** Add streamed text; returns the chunks it completed (raw Markdown, trimmed). */
  push(text: string): string[] {
    this.buf += text
    return this.drain(false)
  }

  /** End of the message: everything left, as chunks. */
  flush(): string[] {
    const out = this.drain(true)
    const rest = this.buf.trim()
    this.buf = ''
    if (rest) out.push(rest)
    return out
  }

  /** Throw away anything buffered (speech stopped). */
  reset(): void {
    this.buf = ''
  }

  /** What has arrived but not yet made a chunk. */
  get pending(): string {
    return this.buf
  }

  private drain(final: boolean): string[] {
    const out: string[] = []
    for (;;) {
      // Leading blank space never starts a chunk.
      const lead = this.buf.match(/^\s*/)?.[0].length ?? 0
      if (lead) this.buf = this.buf.slice(lead)
      if (!this.buf) break
      const fence = this.fenceEnd(final)
      if (fence === WAIT) break
      const end = fence ?? this.boundary(final)
      if (end === null) break
      const chunk = this.buf.slice(0, end).trim()
      this.buf = this.buf.slice(end)
      if (chunk) out.push(chunk)
    }
    return out
  }

  /**
   * When the buffer starts with a code fence: the index just past its closing
   * line (the end of the buffer on flush), or WAIT until that has arrived.
   * Null when the buffer doesn't start with a fence.
   */
  private fenceEnd(final: boolean): number | null {
    const open = FENCE_OPEN.exec(this.buf)
    if (!open) return null
    const marker = open[1]
    const firstNl = this.buf.indexOf('\n')
    if (firstNl < 0) return final ? this.buf.length : WAIT
    const close = new RegExp(`\\n[ \\t]{0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}[ \\t]*(?=\\n|$)`, 'g')
    close.lastIndex = firstNl
    const m = close.exec(this.buf)
    if (!m) return final ? this.buf.length : WAIT
    const after = m.index + m[0].length
    // The closing line is only known to be complete once its newline arrives.
    if (after === this.buf.length && !final) return WAIT
    return after
  }

  /** The end of the first complete chunk in the buffer, or null to wait for more. */
  private boundary(final: boolean): number | null {
    const b = this.buf
    let clause = -1
    let space = -1
    for (let i = 0; i < b.length; i++) {
      const c = b[i]
      if (c === '\n') {
        if (b[i + 1] === '\n') return i
        const lineStart = b.lastIndexOf('\n', i - 1) + 1
        const line = b.slice(lineStart, i)
        const next = b.slice(i + 1)
        const nextNl = next.indexOf('\n')
        const nextLine = nextNl < 0 ? next : next.slice(0, nextNl)
        // Can't tell a soft wrap from a new block until the next line has begun.
        if (!final && nextNl < 0 && nextLine.trim().length < 4 && !isBlockLine(nextLine)) return null
        if (isBlockLine(line) || isBlockLine(nextLine) || /[.!?:;…]["'”’)\]]*\s*$/.test(line)) return i
        continue // a soft wrap: same sentence
      }
      if (c === '.' || c === '!' || c === '?' || c === '…') {
        let j = i + 1
        while (j < b.length && /[.!?…"'”’)\]]/.test(b[j])) j++
        if (j >= b.length) {
          if (final) return j
          return null
        }
        if (!/[ \t]/.test(b[j])) {
          i = j - 1
          continue // "3.5", "app.ts", "e.g.," …
        }
        let k = j
        while (k < b.length && /[ \t]/.test(b[k])) k++
        if (k >= b.length) return final ? j : null
        const nextChar = b[k]
        if (c === '.' && b[i + 1] !== '.') {
          const word = wordBefore(b, i)
          if (ABBREVIATIONS.has(word) || /^[a-z]$/i.test(word)) {
            i = j - 1
            continue
          }
        }
        // "the value is 3. then" — a lower-case start is rarely a new sentence.
        if (/[a-z]/.test(nextChar)) {
          i = j - 1
          continue
        }
        return j
      }
      if ((c === ',' || c === ';' || c === ':' || c === '—') && /\s/.test(b[i + 1] ?? '') && i >= 80) clause = i + 1
      if (c === ' ' && i >= 80) space = i
      if (i + 1 >= SOFT_MAX_CHARS && clause > 0) return clause
      if (i + 1 >= HARD_MAX_CHARS && space > 0) return space
    }
    return final ? b.length : null
  }
}

/**
 * Feeds a stream of *accumulated* text (each update is the whole message so
 * far, as the Agent tab's partial frames are) into a SentenceChunker. When an
 * update doesn't extend what came before, a new text block has begun: the old
 * one is flushed first.
 */
export class AccumulatedTextFeed {
  private seen = ''
  readonly chunker = new SentenceChunker()

  /** The chunks newly completed by this update. */
  update(accumulated: string): string[] {
    if (accumulated.startsWith(this.seen)) {
      const delta = accumulated.slice(this.seen.length)
      this.seen = accumulated
      return delta ? this.chunker.push(delta) : []
    }
    const out = this.chunker.flush()
    this.seen = accumulated
    return [...out, ...this.chunker.push(accumulated)]
  }

  /** The block (or message) is over: the rest, as chunks. */
  end(): string[] {
    return this.chunker.flush()
  }

  /** Everything the feed has been given for the current block. */
  get text(): string {
    return this.seen
  }

  reset(): void {
    this.seen = ''
    this.chunker.reset()
  }
}

/** A whole message in one go: its chunks, in order. */
export function chunkSentences(text: string): string[] {
  const chunker = new SentenceChunker()
  return [...chunker.push(text), ...chunker.flush()]
}
