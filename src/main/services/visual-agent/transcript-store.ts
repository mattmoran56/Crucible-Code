/**
 * Append-only transcript of a visual agent's raw stream-json, both directions.
 *
 * One file per Claude session: `<dir>/<claudeSessionId>.jsonl`, each line
 * `{"at": ISO, "dir": "in" | "out", "line": <raw JSON line>}`. "in" is what
 * Claude Code wrote, "out" is what we wrote to its stdin (user messages and
 * permission answers — Claude does not echo them, so the transcript is the
 * only record of them).
 *
 * Writes go through one ordered promise chain per writer so lines never
 * interleave out of order. A failed write is logged and dropped — losing a
 * transcript line must never kill the session.
 */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

export type TranscriptDirection = 'in' | 'out'

export interface TranscriptEntry {
  at: string
  dir: TranscriptDirection
  line: string
}

const SAFE_ID = /^[A-Za-z0-9-]+$/

export const transcriptPath = (dir: string, claudeSessionId: string): string | null =>
  SAFE_ID.test(claudeSessionId) ? join(dir, `${claudeSessionId}.jsonl`) : null

export class TranscriptWriter {
  private chain: Promise<void> = Promise.resolve()
  private path: string | null = null
  /** Lines that arrived before the session id was known. */
  private pending: string[] = []

  constructor(
    private readonly dir: string,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  /**
   * Point the writer at a session's file. Buffered lines are flushed to it. If
   * the id changes mid-run (Claude assigned a new one on resume), the old
   * file's content is copied into the new one first so history stays whole.
   */
  setSessionId(claudeSessionId: string): void {
    const next = transcriptPath(this.dir, claudeSessionId)
    if (!next || next === this.path) return
    const previous = this.path
    this.path = next
    const buffered = this.pending
    this.pending = []
    this.enqueue(async () => {
      await fs.mkdir(this.dir, { recursive: true })
      if (previous) {
        try {
          const old = await fs.readFile(previous, 'utf-8')
          await fs.appendFile(next, old)
        } catch {
          // Nothing to carry over.
        }
      }
      if (buffered.length > 0) await fs.appendFile(next, buffered.join(''))
    })
  }

  append(dir: TranscriptDirection, line: string, at: string = this.now()): void {
    const text = line.replace(/\n+$/, '')
    if (!text) return
    const entry = `${JSON.stringify({ at, dir, line: text })}\n`
    if (!this.path) {
      this.pending.push(entry)
      return
    }
    const path = this.path
    this.enqueue(() => fs.appendFile(path, entry))
  }

  /** Resolves once every queued write has settled. */
  flush(): Promise<void> {
    return this.chain
  }

  private enqueue(op: () => Promise<void>): void {
    this.chain = this.chain.then(op).catch((err) => {
      console.warn('[visual-agent] transcript write failed:', (err as Error)?.message ?? err)
    })
  }
}

/** Every entry of a stored transcript, oldest first. Missing file → []. */
export async function readTranscript(dir: string, claudeSessionId: string): Promise<TranscriptEntry[]> {
  const path = transcriptPath(dir, claudeSessionId)
  if (!path) return []
  let text: string
  try {
    text = await fs.readFile(path, 'utf-8')
  } catch {
    return []
  }
  const entries: TranscriptEntry[] = []
  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue
    try {
      const parsed = JSON.parse(raw) as Partial<TranscriptEntry>
      if (typeof parsed.line === 'string' && (parsed.dir === 'in' || parsed.dir === 'out')) {
        entries.push({ at: typeof parsed.at === 'string' ? parsed.at : '', dir: parsed.dir, line: parsed.line })
      }
    } catch {
      // A torn final line from a crash; skip it.
    }
  }
  return entries
}
