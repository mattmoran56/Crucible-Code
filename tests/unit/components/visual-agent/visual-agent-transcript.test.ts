import { describe, expect, it } from 'vitest'
import type { VisualAgentEvent } from '../../../../src/shared/visual-agent'
import {
  MAIN_THREAD,
  buildTranscript,
  clockOf,
  piecesOf,
  toolDigest,
  visibleRows,
  withAsides,
  type Aside,
} from '../../../../src/renderer/components/visual-agent/transcript'
import { diffOf, lineDiff } from '../../../../src/renderer/components/visual-agent/ToolCard'

let n = 0
type Body = VisualAgentEvent extends infer E ? (E extends unknown ? Omit<E, 'uuid' | 'seq' | 'at' | 'threadId'> : never) : never
const ev = (body: Body, threadId = MAIN_THREAD, at = `2026-10-21T09:00:${String(n % 60).padStart(2, '0')}.000Z`): VisualAgentEvent =>
  ({ uuid: `u${n}`, seq: n++, threadId, at, ...body }) as VisualAgentEvent

const tool = (id: string, name = 'Read', threadId = MAIN_THREAD, spawnsThread = false) =>
  ev({ kind: 'tool', id, name, input: { file_path: `/x/${id}` }, spawnsThread }, threadId)
const result = (id: string, ok = true, threadId = MAIN_THREAD) => ev({ kind: 'tool-result', id, ok, text: 'out' }, threadId)
const say = (text: string, threadId = MAIN_THREAD) => ev({ kind: 'text', role: 'assistant', text }, threadId)

describe('buildTranscript', () => {
  it('always has a main thread, even with no events', () => {
    const t = buildTranscript([])
    expect(t.main.id).toBe(MAIN_THREAD)
    expect(t.main.rows).toEqual([])
  })

  it('pairs tool calls with their results and hides the paired result row', () => {
    const t = buildTranscript([tool('a'), result('a', false)])
    expect(t.main.rows).toHaveLength(1)
    expect(t.main.rows[0].result?.ok).toBe(false)
  })

  it('keeps a result whose call was never seen as its own row', () => {
    const t = buildTranscript([result('ghost')])
    expect(t.main.rows).toHaveLength(1)
    expect(t.main.rows[0].event.kind).toBe('tool-result')
  })

  it('pairs asks with their decisions', () => {
    const t = buildTranscript([
      ev({ kind: 'ask', id: 'q', tool: 'Bash', input: {}, toolUseId: 't', description: '', reason: '', canAlwaysAllow: true }),
      ev({ kind: 'ask-result', id: 'q', decision: 'always' }),
    ])
    expect(t.main.rows).toHaveLength(1)
    expect(t.main.rows[0].decided?.decision).toBe('always')
  })

  it('turns a spawning tool into a child thread with brief, status and steps', () => {
    const t = buildTranscript([
      ev({ kind: 'tool', id: 'task', name: 'Task', input: { description: 'Look around' }, spawnsThread: true }),
      say('hi', 'task'),
      tool('g', 'Grep', 'task'),
      result('g', true, 'task'),
    ])
    expect(t.main.children).toEqual(['task'])
    const child = t.threads.get('task')!
    expect(child.tool).toBe('Task')
    expect(child.brief).toBe('Look around')
    expect(child.status).toBe('running')
    expect(child.steps).toBe(2)
    expect(t.main.rows[0].spawned).toBe('task')
  })

  it('detects a spawn from its bucket even when spawnsThread is false, and reads status from the result', () => {
    const t = buildTranscript([tool('agent', 'Agent'), say('child', 'agent'), result('agent', false)])
    expect(t.main.rows[0].spawned).toBe('agent')
    expect(t.threads.get('agent')!.status).toBe('failed')
  })

  it('keeps a background sub-agent running past its "launched" result until its task ends', () => {
    const launched = (id: string) =>
      ev({ kind: 'tool-result', id, ok: true, text: 'Async agent launched successfully.\nagentId: a63 (internal ID)' })
    const task = (status: 'running' | 'completed' | 'failed' | 'stopped') =>
      ev({ kind: 'task', toolUseId: 'bg', taskId: 'a63', status })
    const spawn = tool('bg', 'Agent', MAIN_THREAD, true)

    let t = buildTranscript([spawn, task('running'), launched('bg'), say('working', 'bg')])
    expect(t.threads.get('bg')!.status).toBe('running')
    expect(t.threads.get('bg')!.agentId).toBe('a63')
    // Task events are bookkeeping, not rows.
    expect(t.main.rows).toHaveLength(1)

    t = buildTranscript([spawn, task('running'), launched('bg'), task('completed')])
    expect(t.threads.get('bg')!.status).toBe('done')
    // It can be resumed (by a message, or its own background work) and end again.
    t = buildTranscript([spawn, launched('bg'), task('completed'), task('running')])
    expect(t.threads.get('bg')!.status).toBe('running')
    expect(buildTranscript([spawn, launched('bg'), task('failed')]).threads.get('bg')!.status).toBe('failed')
    expect(buildTranscript([spawn, launched('bg'), task('stopped')]).threads.get('bg')!.status).toBe('stopped')
  })

  it('treats a "launched" result with no task events as still running, and reads the agent id from it', () => {
    const t = buildTranscript([
      tool('bg', 'Agent', MAIN_THREAD, true),
      ev({ kind: 'tool-result', id: 'bg', ok: true, text: 'Async agent launched successfully.\nagentId: a63 (internal ID)' }),
    ])
    expect(t.threads.get('bg')!.status).toBe('running')
    expect(t.threads.get('bg')!.agentId).toBe('a63')
  })

  it('reads a sub-agent ending from a <task-notification> note (Claude Code transcripts)', () => {
    const t = buildTranscript([
      tool('bg', 'Agent', MAIN_THREAD, true),
      ev({ kind: 'tool-result', id: 'bg', ok: true, text: 'Async agent launched successfully.' }),
      ev({
        kind: 'note',
        source: 'meta',
        label: 'Background task update',
        text: '<task-notification>\n<task-id>a63</task-id>\n<tool-use-id>bg</tool-use-id>\n<status>completed</status>\n</task-notification>',
      }),
    ])
    expect(t.threads.get('bg')!.status).toBe('done')
    expect(t.threads.get('bg')!.agentId).toBe('a63')
  })

  it('ignores task events for tool calls that are not sub-agents', () => {
    const t = buildTranscript([tool('sh', 'Bash'), ev({ kind: 'task', toolUseId: 'sh', taskId: 'b1', status: 'running' }), result('sh')])
    expect(t.threads.has('sh')).toBe(false)
    expect(t.main.rows[0].result?.ok).toBe(true)
  })

  it('nests sub-agents to any depth', () => {
    const t = buildTranscript([
      tool('outer', 'Task', MAIN_THREAD, true),
      tool('inner', 'Task', 'outer', true),
      say('deep', 'inner'),
    ])
    expect(t.main.children).toEqual(['outer'])
    expect(t.threads.get('outer')!.children).toEqual(['inner'])
    expect(t.threads.get('inner')!.rows).toHaveLength(1)
  })

  it('hangs an orphan thread off main so it stays reachable', () => {
    const t = buildTranscript([say('lost', 'never-seen')])
    expect(t.main.children).toContain('never-seen')
  })

  it('keys rows by position so one uuid can produce several rows', () => {
    const a = say('one')
    const b = { ...say('two'), uuid: a.uuid } as VisualAgentEvent
    const keys = buildTranscript([a, b]).main.rows.map((r) => r.key)
    expect(new Set(keys).size).toBe(2)
  })
})

describe('piecesOf', () => {
  it('folds consecutive non-spawning tools into one group, broken by text and spawns', () => {
    const t = buildTranscript([
      tool('a'),
      tool('b', 'Bash'),
      say('between'),
      tool('c'),
      tool('task', 'Task', MAIN_THREAD, true),
      tool('d'),
    ])
    const kinds = piecesOf(t.main.rows).map((p) => (p.kind === 'tools' ? `tools:${p.rows.length}` : p.kind))
    expect(kinds).toEqual(['tools:2', 'row', 'tools:1', 'row', 'tools:1'])
  })
})

describe('withAsides', () => {
  it('places side-question markers by timestamp', () => {
    const rows = buildTranscript([
      ev({ kind: 'text', role: 'user', text: 'a' }, MAIN_THREAD, '2026-10-21T09:00:01.000Z'),
      ev({ kind: 'text', role: 'user', text: 'b' }, MAIN_THREAD, '2026-10-21T09:00:05.000Z'),
    ]).main.rows
    const aside: Aside = { id: 'f', question: 'q', at: '2026-10-21T09:00:03.000Z', status: 'done' }
    expect(withAsides(piecesOf(rows), [aside]).map((p) => p.kind)).toEqual(['row', 'aside', 'row'])
  })
})

describe('visibleRows', () => {
  it('drops successful results and repeat/clean session rows', () => {
    const rows = buildTranscript([
      ev({ kind: 'session', claudeSessionId: 's', model: 'm', cwd: '/', tools: [], mcpFailed: ['x'] }),
      ev({ kind: 'session', claudeSessionId: 's', model: 'm', cwd: '/', tools: [], mcpFailed: ['x'] }),
      ev({ kind: 'result', ok: true, costUsd: 1, durationMs: 1, usage: null, text: '' }),
      ev({ kind: 'result', ok: false, costUsd: 1, durationMs: 1, usage: null, text: '' }),
    ]).main.rows
    expect(visibleRows(rows).map((r) => r.event.kind)).toEqual(['session', 'result'])
  })
})

describe('helpers', () => {
  it('toolDigest prefers command, then path fields, then description', () => {
    expect(toolDigest({ command: 'ls', description: 'x' })).toBe('ls')
    expect(toolDigest({ description: 'Look', prompt: 'long' })).toBe('Look')
    expect(toolDigest([1])).toBe('')
  })

  it('clockOf formats elapsed time', () => {
    expect(clockOf(7_000)).toBe('0:07')
    expect(clockOf(192_000)).toBe('3:12')
    expect(clockOf(3_729_000)).toBe('1:02:09')
  })

  it('lineDiff keeps shared lines as context', () => {
    expect(lineDiff('a\nb\nc', 'a\nB\nc')).toEqual([
      { type: 'ctx', text: 'a' },
      { type: 'del', text: 'b' },
      { type: 'add', text: 'B' },
      { type: 'ctx', text: 'c' },
    ])
  })

  it('diffOf handles Write as all additions and ignores other tools', () => {
    const write = ev({ kind: 'tool', id: 'w', name: 'Write', input: { content: 'x\ny' }, spawnsThread: false })
    expect(write.kind === 'tool' && diffOf(write)?.every((l) => l.type === 'add')).toBe(true)
    const read = ev({ kind: 'tool', id: 'r', name: 'Read', input: {}, spawnsThread: false })
    expect(read.kind === 'tool' && diffOf(read)).toBeNull()
  })
})
