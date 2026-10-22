/**
 * Claude Code's own session transcript (`<config>/projects/<encoded cwd>/<id>.jsonl`)
 * as visual-agent transcript entries.
 *
 * A visual agent normally rebuilds its history from its own transcript store
 * (raw stream-json, see transcript-store.ts). A conversation that started
 * somewhere else — teleported down from a cloud session, or begun in a
 * terminal — has nothing there, so on resume the history comes from Claude
 * Code's transcript instead. Its `user` / `assistant` rows carry the same
 * `message` objects stream-json does, so each row becomes a stream-json-shaped
 * line the normaliser already understands.
 */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { claudeConfigRoot, projectDirsFor } from '../cloud-session.service'
import type { TranscriptEntry } from './transcript-store'
import { TELEPORT_AUTO_MESSAGE } from '../../../shared/visual-agent'

const SAFE_ID = /^[A-Za-z0-9-]+$/

type Raw = Record<string, unknown>

const obj = (v: unknown): Raw | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : null)

const hasToolResult = (content: unknown): boolean =>
  Array.isArray(content) && content.some((b) => obj(b)?.type === 'tool_result')

/**
 * One Claude transcript row → a stream-json line (as an entry), or null for
 * rows the Agent view does not show (sidechains, bookkeeping rows).
 */
export function claudeRowToEntry(row: unknown): TranscriptEntry | null {
  const raw = obj(row)
  if (!raw) return null
  if (raw.isSidechain === true) return null
  const at = typeof raw.timestamp === 'string' ? raw.timestamp : ''
  const uuid = typeof raw.uuid === 'string' ? raw.uuid : undefined
  const type = raw.type

  if (type === 'user' || type === 'assistant') {
    const message = obj(raw.message)
    if (!message) return null
    const line: Raw = {
      type,
      message,
      parent_tool_use_id: null,
      ...(uuid ? { uuid } : {}),
      ...(at ? { timestamp: at } : {}),
      ...(raw.isMeta === true ? { isMeta: true } : {}),
      // A compaction summary is written by Claude Code, not the person.
      ...(raw.isSynthetic === true || raw.isCompactSummary === true ? { isSynthetic: true } : {}),
    }
    // What the person typed went out on stdin in a live run; tool results came in.
    const dir = type === 'user' && !hasToolResult(message.content) ? 'out' : 'in'
    return { at, dir, line: JSON.stringify(line) }
  }

  if (type === 'system' && raw.subtype === 'compact_boundary') {
    const meta = obj(raw.compactMetadata)
    const line = {
      type: 'system',
      subtype: 'compact_boundary',
      ...(uuid ? { uuid } : {}),
      ...(at ? { timestamp: at } : {}),
      compact_metadata: { trigger: meta?.trigger ?? null, pre_tokens: meta?.preTokens ?? null },
    }
    return { at, dir: 'in', line: JSON.stringify(line) }
  }
  return null
}

/** A row's plain text (string content or its text blocks), '' when it has none. */
const rowText = (row: unknown): string => {
  const content = obj(obj(row)?.message)?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((b) => (obj(b)?.type === 'text' ? String(obj(b)?.text ?? '') : '')).join('')
}

/** The automated first message Crucible Code sent into a teleported REPL (exact text). */
export const isTeleportAutoMessage = (row: unknown): boolean =>
  obj(row)?.type === 'user' && rowText(row).trim() === TELEPORT_AUTO_MESSAGE

/**
 * Whether Claude has answered the automated teleport message: a later
 * assistant row with text. Until then the turn is still running.
 */
export function teleportAutoReplied(text: string): boolean {
  let sent = false
  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue
    let row: unknown
    try {
      row = JSON.parse(raw)
    } catch {
      continue
    }
    if (isTeleportAutoMessage(row)) sent = true
    else if (sent && obj(row)?.type === 'assistant' && rowText(row).trim() !== '') return true
  }
  return false
}

/**
 * A whole Claude transcript file's text → entries, oldest first. Torn lines
 * are skipped. The automated teleport message stays (normalise folds it into
 * a "Teleported from the cloud" note); Claude's reply to it is dropped.
 */
export function claudeTranscriptToEntries(text: string): TranscriptEntry[] {
  const entries: TranscriptEntry[] = []
  let afterAuto = false
  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue
    let row: unknown
    try {
      row = JSON.parse(raw)
    } catch {
      continue
    }
    if (isTeleportAutoMessage(row)) afterAuto = true
    else if (obj(row)?.type === 'user') afterAuto = false
    else if (afterAuto && obj(row)?.type === 'assistant') continue
    const entry = claudeRowToEntry(row)
    if (entry) entries.push(entry)
  }
  return entries
}

/**
 * Where Claude Code keeps a session's transcript: the cwd's project directory
 * first (raw and real path), then any project directory (a session can have
 * been started from another cwd). Null when there is none.
 */
export async function findClaudeTranscript(
  claudeSessionId: string,
  cwd: string,
  configDir?: string | null
): Promise<string | null> {
  if (!SAFE_ID.test(claudeSessionId)) return null
  const file = `${claudeSessionId}.jsonl`
  const exists = async (path: string): Promise<boolean> => {
    try {
      return (await fs.stat(path)).isFile()
    } catch {
      return false
    }
  }
  for (const dir of await projectDirsFor(cwd, configDir)) {
    if (await exists(join(dir, file))) return join(dir, file)
  }
  const root = join(claudeConfigRoot(configDir), 'projects')
  let dirs: string[]
  try {
    dirs = await fs.readdir(root)
  } catch {
    return null
  }
  for (const dir of dirs) {
    if (await exists(join(root, dir, file))) return join(root, dir, file)
  }
  return null
}

/** A session's history from Claude Code's transcript, as entries ([] when there is none). */
export async function readClaudeTranscript(
  claudeSessionId: string,
  cwd: string,
  configDir?: string | null
): Promise<TranscriptEntry[]> {
  const path = await findClaudeTranscript(claudeSessionId, cwd, configDir)
  if (!path) return []
  try {
    return claudeTranscriptToEntries(await fs.readFile(path, 'utf-8'))
  } catch {
    return []
  }
}
