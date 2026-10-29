// The pure half of the Visual Agent panel: a flat event list resolved into the
// threads, rows and folded pieces the screen draws.
//
// Ported from meet-jef's `components/agent/transcript.ts`. The rules that were
// bugs first there still hold here:
//
// - **Arrival order is the order.** `seq` is not comparable across a replay
//   and a live stream, so nothing here sorts by it.
// - **A row's key is its position in the run, not its uuid.** One assistant
//   message can produce several events.
// - **A thread is found by the events on it, not only by the flag.** A tool
//   whose id has its own bucket of events is a spawn even when `spawnsThread`
//   is false.
// - **A thread nobody claims hangs off the main thread**, so a sub-agent whose
//   spawning call was never seen is still reachable from the tray.
// - **A tool result does not mean a sub-agent finished.** A background one
//   answers "Async agent launched" at once; its end is the task notification.

import type {
  VisualAgentEvent,
  VisualAgentFork,
  VisualAgentRunState,
  VisualAgentTaskStatus,
} from '../../../shared/visual-agent'

export const MAIN_THREAD = 'main'

export type EventOf<K extends VisualAgentEvent['kind']> = Extract<VisualAgentEvent, { kind: K }>
export type ToolEvent = EventOf<'tool'>
export type ToolResultEvent = EventOf<'tool-result'>
export type AskEvent = EventOf<'ask'>
export type AskResultEvent = EventOf<'ask-result'>
export type TaskEvent = EventOf<'task'>

export type ThreadStatus = 'running' | 'done' | 'failed' | 'stopped'

/** One row of a conversation: an event, and what came back for it. */
export interface Row {
  /** React's key — the event's position in the run. */
  key: string
  event: VisualAgentEvent
  /** For a `tool` row, the result once it has arrived. */
  result: ToolResultEvent | null
  /** For an `ask` row, the decision once one has been made. */
  decided: AskResultEvent | null
  /** For a `tool` row that started a sub-agent, that sub-agent's thread id. */
  spawned: string | null
}

/** One conversation inside a run: the main one, or one sub-agent's. */
export interface Thread {
  /** `MAIN_THREAD`, or the id of the tool call that started it. */
  id: string
  /** The tool that started it (`Task`/`Agent`). Empty for main. */
  tool: string
  /** What it was asked for, in one line. */
  brief: string
  rows: Row[]
  /** Threads started from inside this one, in spawn order. */
  children: string[]
  status: ThreadStatus
  /** Rows in it — what a tray pill counts. */
  steps: number
  /** The CLI's id for the sub-agent (SendMessage's `to`), once it is known. */
  agentId: string | null
}

const TASK_STATUS: Record<VisualAgentTaskStatus, ThreadStatus> = {
  running: 'running',
  completed: 'done',
  failed: 'failed',
  stopped: 'stopped',
}

/** What a background sub-agent's tool result says the moment it starts. */
const LAUNCHED = /^Async agent launched\b/
const AGENT_ID = /\bagentId: ([A-Za-z0-9_-]+)/

/**
 * The task lifecycle a `<task-notification>` note carries. Claude Code's own
 * transcript (teleported or terminal sessions) has these rather than the
 * stream's task events.
 */
const notifiedTask = (event: VisualAgentEvent): Pick<TaskEvent, 'toolUseId' | 'taskId' | 'status'> | null => {
  if (event.kind !== 'note' || !event.text.includes('<task-notification>')) return null
  const tag = (name: string): string | null =>
    new RegExp(`<${name}>([^<]+)</${name}>`).exec(event.text)?.[1]?.trim() || null
  const toolUseId = tag('tool-use-id')
  const status = tag('status') as VisualAgentTaskStatus | null
  if (!toolUseId || !status || !(status in TASK_STATUS)) return null
  return { toolUseId, taskId: tag('task-id') ?? '', status }
}

export interface Transcript {
  threads: Map<string, Thread>
  main: Thread
}

const statusOf = (result: ToolResultEvent | null, task: Pick<TaskEvent, 'status'> | undefined): ThreadStatus => {
  if (task) return TASK_STATUS[task.status]
  if (!result) return 'running'
  if (!result.ok) return 'failed'
  return LAUNCHED.test(result.text) ? 'running' : 'done'
}

export const buildTranscript = (events: readonly VisualAgentEvent[]): Transcript => {
  const byThread = new Map<string, VisualAgentEvent[]>()
  const order = new Map<VisualAgentEvent, number>()
  events.forEach((event, index) => {
    order.set(event, index)
    const bucket = byThread.get(event.threadId)
    if (bucket) bucket.push(event)
    else byThread.set(event.threadId, [event])
  })

  // Paired across the whole run, by id alone.
  const results = new Map<string, ToolResultEvent>()
  const calls = new Map<string, ToolEvent>()
  const decisions = new Map<string, AskResultEvent>()
  const asks = new Map<string, AskEvent>()
  // The latest lifecycle report per spawning tool call.
  const tasks = new Map<string, Pick<TaskEvent, 'taskId' | 'status'>>()
  for (const event of events) {
    const notified = event.kind === 'task' ? event : notifiedTask(event)
    if (notified) tasks.set(notified.toolUseId, notified)
    if (event.kind === 'tool-result') results.set(event.id, event)
    else if (event.kind === 'tool') calls.set(event.id, event)
    else if (event.kind === 'ask-result') decisions.set(event.id, event)
    else if (event.kind === 'ask') asks.set(event.id, event)
  }

  const threads = new Map<string, Thread>()
  const thread = (id: string): Thread => {
    const held = threads.get(id)
    if (held) return held
    const made: Thread = { id, tool: '', brief: '', rows: [], children: [], status: 'done', steps: 0, agentId: null }
    threads.set(id, made)
    return made
  }
  thread(MAIN_THREAD)

  for (const [id, bucket] of byThread) {
    const held = thread(id)
    for (const event of bucket) {
      if (event.kind === 'task') continue
      if (event.kind === 'tool-result' && calls.has(event.id)) continue
      if (event.kind === 'ask-result' && asks.has(event.id)) continue

      const row: Row = {
        key: `r${order.get(event) ?? held.rows.length}`,
        event,
        result: null,
        decided: null,
        spawned: null,
      }
      if (event.kind === 'ask') row.decided = decisions.get(event.id) ?? null
      if (event.kind === 'tool') {
        row.result = results.get(event.id) ?? null
        if (event.id !== id && (byThread.has(event.id) || event.spawnsThread)) {
          row.spawned = event.id
          const child = thread(event.id)
          child.tool = event.name
          child.brief = oneLine(toolDigest(event.input), 60)
          child.status = statusOf(row.result, tasks.get(event.id))
          child.agentId = tasks.get(event.id)?.taskId || AGENT_ID.exec(row.result?.text ?? '')?.[1] || null
          if (!held.children.includes(event.id)) held.children.push(event.id)
        }
      }
      held.rows.push(row)
    }
  }

  for (const held of threads.values()) held.steps = held.rows.length

  const main = thread(MAIN_THREAD)
  const reachable = new Set<string>()
  const walk = (id: string): void => {
    if (reachable.has(id)) return
    reachable.add(id)
    for (const child of threads.get(id)?.children ?? []) walk(child)
  }
  walk(MAIN_THREAD)
  for (const id of [...threads.keys()]) {
    if (reachable.has(id)) continue
    main.children.push(id)
    walk(id)
  }

  return { threads, main }
}

/* --- side questions (/btw forks) ---------------------------------------- */

export interface Aside {
  id: string
  question: string
  /** When it was asked — positions the marker in the main thread. */
  at: string
  status: ThreadStatus
}

const ASIDE_STATUS: Record<VisualAgentRunState, ThreadStatus> = {
  starting: 'running',
  running: 'running',
  // A fork is one question and one answer; idle is a moment too short to see.
  idle: 'running',
  'needs-input': 'running',
  done: 'done',
  failed: 'failed',
}

export const asideOf = (fork: VisualAgentFork): Aside => ({
  id: fork.id,
  question: fork.question,
  at: fork.startedAt,
  status: ASIDE_STATUS[fork.state] ?? 'done',
})

/* --- folding ------------------------------------------------------------ */

export type Piece =
  | { kind: 'row'; row: Row }
  | { kind: 'tools'; rows: Row[] }
  | { kind: 'aside'; aside: Aside }

const foldable = (row: Row): boolean => row.event.kind === 'tool' && row.spawned === null

/** Consecutive non-spawning tool calls gathered into one tool-group piece. */
export const piecesOf = (rows: readonly Row[]): Piece[] => {
  const pieces: Piece[] = []
  for (const row of rows) {
    const last = pieces[pieces.length - 1]
    if (foldable(row)) {
      if (last?.kind === 'tools') last.rows.push(row)
      else pieces.push({ kind: 'tools', rows: [row] })
    } else {
      pieces.push({ kind: 'row', row })
    }
  }
  return pieces
}

const pieceAt = (piece: Piece): string => {
  if (piece.kind === 'aside') return piece.aside.at
  if (piece.kind === 'row') return piece.row.event.at
  return piece.rows[piece.rows.length - 1]?.event.at ?? ''
}

/** Side-question markers placed by the clock (seq is not comparable across replays). */
export const withAsides = (pieces: Piece[], asides: readonly Aside[]): Piece[] => {
  if (asides.length === 0) return pieces
  const marks = [...asides].sort((a, b) => a.at.localeCompare(b.at))
  const out: Piece[] = []
  let at = 0
  for (const aside of marks) {
    while (at < pieces.length && pieceAt(pieces[at]) <= aside.at) out.push(pieces[at++])
    out.push({ kind: 'aside', aside })
  }
  while (at < pieces.length) out.push(pieces[at++])
  return out
}

/** Rows that draw nothing in the ordinary case, dropped so they leave no gap. */
export const visibleRows = (rows: readonly Row[]): Row[] => {
  let seenSession = false
  return rows.filter((row) => {
    const event = row.event
    if (event.kind === 'result') return !event.ok
    if (event.kind === 'session') {
      if (seenSession) return false
      seenSession = true
      return event.mcpFailed.length > 0
    }
    return true
  })
}

/* --- small writing helpers --------------------------------------------- */

export const spanOf = (ms: number | null): string => {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return ''
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60_000)
  return `${minutes}m ${Math.round((ms % 60_000) / 1000)}s`
}

/** Whole-second elapsed clock: 0:07, 3:12, 1:02:09. */
export const clockOf = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

export const costOf = (usd: number | null): string =>
  usd === null || !Number.isFinite(usd) ? '' : `$${usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2)}`

export const tokensOf = (n: number): string => {
  if (!Number.isFinite(n)) return ''
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

const DIGEST_KEYS = ['command', 'file_path', 'path', 'pattern', 'url', 'query', 'description', 'prompt']

/** What a tool call is about, in Claude Code's own field names. */
export const toolDigest = (input: unknown): string => {
  if (typeof input === 'string') return input
  if (!input || typeof input !== 'object' || Array.isArray(input)) return ''
  const held = input as Record<string, unknown>
  for (const key of DIGEST_KEYS) {
    const value = held[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

export const oneLine = (text: string, limit = 88): string => {
  const first = text.replace(/\s+/g, ' ').trim()
  return first.length > limit ? `${first.slice(0, limit - 1)}…` : first
}

export const pretty = (value: unknown): string => {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2) ?? ''
  } catch {
    return String(value)
  }
}
