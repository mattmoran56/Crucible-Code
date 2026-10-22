/**
 * Reading Claude Code's `--output-format stream-json` output.
 *
 * Ported from meet-jef's `packages/sessions/src/agent/{stream,meta,permissions}.ts`.
 * This is the only file in the visual-agent feature that knows the wire
 * format; everything downstream sees `VisualAgentEvent` from
 * `src/shared/visual-agent.ts`, so a Claude Code release that renames a field
 * is a change here and nowhere else.
 *
 * Rules:
 *  - A line we do not understand is dropped, never surfaced. The raw line is on
 *    disk in the transcript either way.
 *  - Nesting comes from `parent_tool_use_id` and nothing else.
 *  - Pure: no I/O, no clocks except through the context.
 */
import type { VisualAgentEvent, VisualAgentUsage } from '../../../shared/visual-agent'
import { TELEPORT_AUTO_LABEL, TELEPORT_AUTO_MESSAGE } from '../../../shared/visual-agent'

export const MAIN_THREAD = 'main'

type Raw = Record<string, unknown>

const str = (value: unknown): string | null => (typeof value === 'string' ? value : null)
const nonEmpty = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null
const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null
const obj = (value: unknown): Raw | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : null
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

/** Tool calls that hand work to a subagent. */
const SPAWNING_TOOLS = new Set(['Task', 'Agent'])

const usageOf = (value: unknown): VisualAgentUsage | null => {
  const held = obj(value)
  if (!held) return null
  return {
    input: num(held.input_tokens) ?? 0,
    output: num(held.output_tokens) ?? 0,
    cacheRead: num(held.cache_read_input_tokens) ?? 0,
    cacheWrite: num(held.cache_creation_input_tokens) ?? 0,
  }
}

export const usageTotal = (u: VisualAgentUsage): number =>
  u.input + u.output + u.cacheRead + u.cacheWrite

/** A tool result's content flattened to text. */
const contentText = (value: unknown): string => {
  const direct = str(value)
  if (direct !== null) return direct
  return arr(value)
    .map((block) => {
      const held = obj(block)
      if (!held) return ''
      if (held.type === 'text') return str(held.text) ?? ''
      if (held.type === 'image') return '[image]'
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

/** When a line was written, if it says. */
export const stampOf = (line: unknown): string | null => {
  const at = str(obj(line)?.timestamp)
  return at !== null && Number.isFinite(Date.parse(at)) ? at : null
}

/** Usage an assistant message reports (cumulative for the turn — take the latest). */
export const usageIn = (line: unknown): VisualAgentUsage | null => {
  const raw = obj(line)
  if (!raw || str(raw.type) !== 'assistant') return null
  const message = obj(raw.message)
  return message ? usageOf(message.usage) : null
}

/**
 * The conversation id a line proves exists, or null. Only from a line that is
 * part of a turn: `system/init`, `user`, `assistant`, `result`. Startup notices
 * like `system/commands_changed` carry an id that may never be persisted, and
 * `--resume`-ing it fails with "No conversation found".
 */
export const conversationIdIn = (line: unknown): string | null => {
  const raw = obj(line)
  if (!raw) return null
  const type = str(raw.type)
  const turn =
    (type === 'system' && str(raw.subtype) === 'init') ||
    type === 'user' ||
    type === 'assistant' ||
    type === 'result'
  const id = nonEmpty(raw.session_id)
  return turn && id ? id : null
}

/** The model a `system/init` line announces, or null. */
export const initModelIn = (line: unknown): string | null => {
  const raw = obj(line)
  if (!raw || raw.type !== 'system' || raw.subtype !== 'init') return null
  return nonEmpty(raw.model)
}

/* --- meta: telling the person apart from Claude Code speaking as them ------ */

type NoteSource = 'skill' | 'command' | 'command-output' | 'hook' | 'reminder' | 'interrupt' | 'meta'
interface Note {
  source: NoteSource
  label: string
}

const WRAPPERS = new Set([
  'command-name',
  'command-message',
  'command-args',
  'local-command-stdout',
  'local-command-stderr',
  'local-command-caveat',
  'system-reminder',
  'user-prompt-submit-hook',
  'task-notification',
])

const INTERRUPT = /^\[Request interrupted by user[^\]]*\]$/
const SKILL = /^Base directory for this skill:\s*(\S+)/

const wrappersOf = (text: string): Map<string, string> | null => {
  const found = new Map<string, string>()
  let rest = text.trim()
  if (!rest.startsWith('<')) return null
  while (rest !== '') {
    const open = /^<([a-z-]+)>/.exec(rest)
    if (!open || !WRAPPERS.has(open[1]!)) return null
    const tag = open[1]!
    const close = `</${tag}>`
    const end = rest.indexOf(close)
    if (end === -1) return null
    found.set(tag, rest.slice(open[0].length, end).trim())
    rest = rest.slice(end + close.length).trim()
  }
  return found
}

const skillName = (path: string): string => path.replace(/\/+$/, '').split('/').pop() || path

const wrapperNote = (text: string): Note | null => {
  const tags = wrappersOf(text)
  if (!tags) return null
  const name =
    tags.get('command-name') ?? (tags.has('command-message') ? `/${tags.get('command-message')}` : null)
  if (name) return { source: 'command', label: `Ran ${name.startsWith('/') ? name : `/${name}`}` }
  if (tags.has('local-command-stdout') || tags.has('local-command-stderr')) {
    return { source: 'command-output', label: 'Command output' }
  }
  if (tags.has('user-prompt-submit-hook')) return { source: 'hook', label: 'Hook output' }
  const reminder = tags.get('system-reminder')
  if (reminder !== undefined) {
    const first = reminder.split('\n', 1)[0] ?? ''
    return /\bhook\b/i.test(first)
      ? { source: 'hook', label: 'Hook output' }
      : { source: 'reminder', label: 'System reminder' }
  }
  if (tags.has('task-notification')) return { source: 'meta', label: 'Background task update' }
  return { source: 'meta', label: 'Added by Claude Code' }
}

const flaggedNote = (text: string): Note => {
  const skill = SKILL.exec(text.trimStart())
  if (skill) return { source: 'skill', label: `Loaded skill ${skillName(skill[1]!)}` }
  return wrapperNote(text) ?? { source: 'meta', label: 'Added by Claude Code' }
}

/** Null means a person wrote it — the default, because hiding what somebody typed is worse. */
export const noteFor = (raw: Raw, text: string): Note | null => {
  if (text.trim() === TELEPORT_AUTO_MESSAGE) return { source: 'meta', label: TELEPORT_AUTO_LABEL }
  if (raw.isSynthetic === true || raw.isMeta === true) return flaggedNote(text)
  if (INTERRUPT.test(text.trim())) return { source: 'interrupt', label: 'Interrupted' }
  return wrapperNote(text)
}

/* --- permissions ---------------------------------------------------------- */

export interface PermissionGrantRule {
  toolName: string
  ruleContent?: string
}

export interface PermissionRequest {
  id: string
  tool: string
  input: unknown
  toolUseId: string | null
  description: string | null
  reason: string | null
  grants: PermissionGrantRule[]
  noStandingRule: boolean
  needsPerson: boolean
}

// eslint-disable-next-line no-control-regex
const plain = (text: string): string => text.replace(/\u001b\[[0-9;]*m/g, '').trim()

const grantsIn = (value: unknown): PermissionGrantRule[] => {
  if (!Array.isArray(value)) return []
  const rules: PermissionGrantRule[] = []
  for (const entry of value) {
    const held = obj(entry)
    if (!held || held.type !== 'addRules' || held.behavior !== 'allow') continue
    for (const rule of arr(held.rules)) {
      const one = obj(rule)
      const toolName = one ? nonEmpty(one.toolName) : null
      if (!toolName) continue
      const ruleContent = one ? nonEmpty(one.ruleContent) : null
      rules.push(ruleContent === null ? { toolName } : { toolName, ruleContent })
    }
  }
  return rules
}

/** Reads a `can_use_tool` control request, or null for every other line. */
export const permissionRequestIn = (line: unknown): PermissionRequest | null => {
  const raw = obj(line)
  if (!raw || raw.type !== 'control_request') return null
  const request = obj(raw.request)
  if (!request || request.subtype !== 'can_use_tool') return null
  const id = nonEmpty(raw.request_id)
  const tool = nonEmpty(request.tool_name)
  if (!id || !tool) return null
  const description = nonEmpty(request.description)
  const reason = nonEmpty(request.decision_reason)
  return {
    id,
    tool,
    input: request.input ?? null,
    toolUseId: nonEmpty(request.tool_use_id),
    description: description ? plain(description) : null,
    reason:
      reason && (!description || plain(reason) !== plain(description)) ? plain(reason) : null,
    grants: grantsIn(request.permission_suggestions),
    noStandingRule: request.suppress_always_allow_rule === true,
    needsPerson: request.requires_user_interaction === true,
  }
}

export const canAlwaysAllow = (request: PermissionRequest): boolean =>
  !request.noStandingRule && request.grants.length > 0

const decisionIn = (raw: Raw): { id: string; decision: 'allow' | 'always' | 'deny' } | null => {
  const outer = obj(raw.response)
  if (!outer || outer.subtype !== 'success') return null
  const id = nonEmpty(outer.request_id)
  const inner = obj(outer.response)
  if (!id || !inner) return null
  if (inner.behavior === 'deny') return { id, decision: 'deny' }
  if (inner.behavior !== 'allow') return null
  const rules = inner.updatedPermissions
  return { id, decision: Array.isArray(rules) && rules.length > 0 ? 'always' : 'allow' }
}

/** A control_response to a request *we* sent, or null. */
export const controlResponseIn = (
  line: unknown
): { requestId: string; ok: boolean; error: string | null } | null => {
  const raw = obj(line)
  if (!raw || raw.type !== 'control_response') return null
  const response = obj(raw.response)
  if (!response) return null
  const requestId = nonEmpty(response.request_id)
  if (!requestId) return null
  if (response.subtype === 'error') {
    return { requestId, ok: false, error: nonEmpty(response.error) ?? 'the session refused that' }
  }
  return { requestId, ok: response.subtype === 'success', error: null }
}

/* --- partial messages ----------------------------------------------------- */

export interface PartialDelta {
  messageId: string
  threadId: string
  text: string
}

/**
 * A text delta from `--include-partial-messages`, or null. Only text deltas —
 * tool input and thinking deltas are dropped; the buffered `assistant` line
 * that follows carries them in full.
 */
export const partialDeltaIn = (line: unknown): PartialDelta | null => {
  const raw = obj(line)
  if (!raw || raw.type !== 'stream_event') return null
  const event = obj(raw.event)
  if (!event || event.type !== 'content_block_delta') return null
  const delta = obj(event.delta)
  if (!delta || delta.type !== 'text_delta') return null
  const text = str(delta.text)
  const messageId = nonEmpty(raw.api_message_id) ?? nonEmpty(raw.message_id)
  if (text === null || !messageId) return null
  return { messageId, threadId: nonEmpty(raw.parent_tool_use_id) ?? MAIN_THREAD, text }
}

/** The message id of an `assistant` line, used to clear the matching partial. */
export const assistantMessageIdIn = (line: unknown): string | null => {
  const raw = obj(line)
  if (!raw || raw.type !== 'assistant') return null
  return nonEmpty(obj(raw.message)?.id)
}

/* --- the normaliser ------------------------------------------------------- */

export interface NormaliseContext {
  /** Next sequence number; the caller owns it so a resumed run keeps counting. */
  seq: number
  fallbackId: () => string
  now: () => string
  /** Set on events rebuilt from a stored transcript. */
  replayed?: boolean
  /**
   * `${sessionId}|${model}` of the last session event emitted. Claude Code
   * re-announces `system/init` at the start of every turn; only a change
   * (first turn, new model, new id) becomes an event.
   */
  lastSession?: string | null
}

/** Turns one parsed line into zero or more events. */
export const normalise = (line: unknown, ctx: NormaliseContext): VisualAgentEvent[] => {
  const raw = obj(line)
  if (!raw) return []
  const type = str(raw.type)
  if (!type) return []

  const threadId = nonEmpty(raw.parent_tool_use_id) ?? MAIN_THREAD
  const at = stampOf(raw) ?? ctx.now()
  const base = (uuid: string | null) => ({
    uuid: uuid ?? ctx.fallbackId(),
    seq: ctx.seq++,
    threadId,
    at,
    ...(ctx.replayed ? { replayed: true } : {}),
  })

  if (type === 'system') {
    const subtype = str(raw.subtype)
    if (subtype === 'init') {
      const claudeSessionId = str(raw.session_id) ?? ''
      const model = str(raw.model) ?? ''
      const key = `${claudeSessionId}|${model}`
      if (ctx.lastSession === key) return []
      ctx.lastSession = key
      const mcpFailed = arr(raw.mcp_servers)
        .map((entry) => obj(entry))
        .filter((e): e is Raw => !!e && e.status === 'failed' && typeof e.name === 'string')
        .map((e) => e.name as string)
      return [
        {
          ...base(str(raw.uuid)),
          kind: 'session',
          claudeSessionId,
          model,
          cwd: str(raw.cwd) ?? '',
          tools: arr(raw.tools).filter((t): t is string => typeof t === 'string'),
          mcpFailed,
        },
      ]
    }
    if (subtype === 'compact_boundary') {
      const meta = obj(raw.compact_metadata)
      const trigger = meta ? str(meta.trigger) : null
      return [
        {
          ...base(str(raw.uuid)),
          kind: 'compacted',
          tokensBefore: meta ? num(meta.pre_tokens) : null,
          trigger: trigger === 'auto' || trigger === 'manual' ? trigger : null,
        },
      ]
    }
    if (subtype === 'api_retry') {
      return [
        {
          ...base(str(raw.uuid)),
          kind: 'retry',
          attempt: num(raw.attempt) ?? 0,
          max: num(raw.max_retries) ?? 0,
          delayMs: num(raw.retry_delay_ms) ?? 0,
          reason: str(raw.error) ?? 'unknown',
        },
      ]
    }
    return []
  }

  if (type === 'assistant' || type === 'user') {
    const message = obj(raw.message)
    if (!message) return []
    const role = type === 'assistant' ? ('assistant' as const) : ('user' as const)
    const events: VisualAgentEvent[] = []

    const prose = (text: string): VisualAgentEvent => {
      const note = role === 'user' ? noteFor(raw, text) : null
      return note
        ? { ...base(str(raw.uuid)), kind: 'note', source: note.source, label: note.label, text }
        : { ...base(str(raw.uuid)), kind: 'text', role, text }
    }

    const blocks = typeof message.content === 'string' ? [message.content] : arr(message.content)
    for (const block of blocks) {
      const held = obj(block)
      if (!held) {
        const text = str(block)
        if (text && text.trim()) events.push(prose(text))
        continue
      }
      switch (held.type) {
        case 'text': {
          const text = str(held.text) ?? ''
          if (text.trim()) events.push(prose(text))
          break
        }
        case 'thinking': {
          events.push({ ...base(str(raw.uuid)), kind: 'thinking', text: str(held.thinking) ?? '' })
          break
        }
        case 'tool_use': {
          const id = nonEmpty(held.id)
          if (!id) break
          const name = str(held.name) ?? 'tool'
          events.push({
            ...base(str(raw.uuid)),
            kind: 'tool',
            id,
            name,
            input: held.input ?? null,
            spawnsThread: SPAWNING_TOOLS.has(name),
          })
          break
        }
        case 'tool_result': {
          const id = nonEmpty(held.tool_use_id)
          if (!id) break
          events.push({
            ...base(str(raw.uuid)),
            kind: 'tool-result',
            id,
            ok: held.is_error !== true,
            text: contentText(held.content),
          })
          break
        }
        default:
          break
      }
    }
    // One wire message can become several events; keep their uuids distinct
    // so the renderer can key on them.
    if (events.length > 1) {
      events.forEach((e, i) => {
        if (i > 0) e.uuid = `${e.uuid}:${i}`
      })
    }
    return events
  }

  if (type === 'result') {
    const subtype = str(raw.subtype)
    return [
      {
        ...base(str(raw.uuid)),
        kind: 'result',
        // Both halves: a refused login is subtype `success` with is_error true.
        ok: subtype === 'success' && raw.is_error !== true,
        costUsd: num(raw.total_cost_usd),
        durationMs: num(raw.duration_ms),
        usage: usageOf(raw.usage),
        text: str(raw.result) ?? '',
      },
    ]
  }

  if (type === 'control_request') {
    const asked = permissionRequestIn(raw)
    if (!asked) return []
    return [
      {
        ...base(null),
        kind: 'ask',
        id: asked.id,
        tool: asked.tool,
        input: asked.input,
        toolUseId: asked.toolUseId ?? '',
        description: asked.description ?? '',
        reason: asked.reason ?? '',
        canAlwaysAllow: canAlwaysAllow(asked),
      },
    ]
  }

  if (type === 'control_response') {
    const decided = decisionIn(raw)
    if (!decided) return []
    return [{ ...base(null), kind: 'ask-result', id: decided.id, decision: decided.decision }]
  }

  // stream_event partials are handled by `partialDeltaIn`; everything else is dropped.
  return []
}

/** Splits a byte stream into whole lines. Non-JSON lines go to `onNoise`. */
export const lineReader = (
  onLine: (value: unknown, raw: string) => void,
  onNoise?: (raw: string) => void
): { push(chunk: string): void; flush(): void } => {
  let held = ''
  const take = (text: string): void => {
    const trimmed = text.trim()
    if (!trimmed) return
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      onNoise?.(trimmed)
      return
    }
    onLine(parsed, trimmed)
  }
  return {
    push(chunk: string) {
      held += chunk
      let index = held.indexOf('\n')
      while (index !== -1) {
        // Consume before dispatching: a handler may re-enter via flush()
        // (e.g. killing a fork on `result` fires its exit handler).
        const one = held.slice(0, index)
        held = held.slice(index + 1)
        take(one)
        index = held.indexOf('\n')
      }
    },
    flush() {
      const rest = held
      held = ''
      take(rest)
    },
  }
}
