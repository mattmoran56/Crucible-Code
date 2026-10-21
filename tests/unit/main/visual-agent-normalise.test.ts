import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/main/services/terminal.service', () => ({
  AUTO_PERMISSION_MODE_ARGS: [],
}))

import {
  conversationIdIn,
  lineReader,
  normalise,
  partialDeltaIn,
  permissionRequestIn,
  usageIn,
  assistantMessageIdIn,
  controlResponseIn,
  type NormaliseContext,
} from '../../../src/main/services/visual-agent/normalise'
import {
  agentArgv,
  forkArgv,
  interruptFrame,
  isValidModel,
  permissionResponseFrame,
  questionAnswerFrame,
  resolveModel,
  setModelFrame,
  sideQuestionPreamble,
  userMessageFrame,
} from '../../../src/main/services/visual-agent/launch'

const SID = '14b03bfe-3bf5-4a09-adb1-896839d8a45d'

const ctx = (over: Partial<NormaliseContext> = {}): NormaliseContext => {
  let n = 0
  return { seq: 0, fallbackId: () => `fb-${n++}`, now: () => '2026-10-21T00:00:00.000Z', lastSession: null, ...over }
}

// Lines shaped like real Claude Code 2.1.306 output (trimmed).
const INIT = {
  type: 'system',
  subtype: 'init',
  cwd: '/wt',
  session_id: SID,
  tools: ['Task', 'Bash', 'Read'],
  mcp_servers: [
    { name: 'notion', status: 'connected' },
    { name: 'broken', status: 'failed' },
    { name: 'gmail', status: 'needs-auth' },
  ],
  model: 'claude-haiku-5-5',
  permissionMode: 'auto',
  uuid: 'init-uuid',
}
const COMMANDS_CHANGED = { type: 'system', subtype: 'commands_changed', commands: [], session_id: 'never-persisted', uuid: 'cc' }
const ASSISTANT_TEXT = {
  type: 'assistant',
  message: {
    model: 'claude-haiku-5-5',
    id: 'msg_011CgFFMkqpmchVUTazqyMKR',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: 'Hi! What can I help you with today?' }],
    usage: { input_tokens: 2, cache_creation_input_tokens: 11648, cache_read_input_tokens: 12693, output_tokens: 14 },
  },
  parent_tool_use_id: null,
  session_id: SID,
  uuid: 'a-uuid',
  timestamp: '2026-10-21T10:46:31.997Z',
}
const ASSISTANT_TOOL = {
  type: 'assistant',
  message: {
    id: 'msg_tool',
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: 'Let me look.' },
      { type: 'tool_use', id: 'toolu_017o', name: 'Bash', input: { command: 'touch probe.txt' } },
      { type: 'tool_use', id: 'toolu_task', name: 'Task', input: { description: 'explore' } },
    ],
  },
  parent_tool_use_id: null,
  session_id: SID,
  uuid: 't-uuid',
}
const TOOL_RESULT = {
  type: 'user',
  message: {
    role: 'user',
    content: [{ tool_use_id: 'toolu_017o', type: 'tool_result', content: '(Bash completed with no output)', is_error: false }],
  },
  parent_tool_use_id: null,
  session_id: SID,
  uuid: 'r-uuid',
}
const SUBAGENT = {
  type: 'assistant',
  message: { id: 'msg_sub', role: 'assistant', content: [{ type: 'text', text: 'Searching src/' }] },
  parent_tool_use_id: 'toolu_task',
  session_id: SID,
  uuid: 's-uuid',
}
const RESULT = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  duration_ms: 3456,
  total_cost_usd: 0.0024,
  result: 'Hi!',
  usage: { input_tokens: 2, cache_creation_input_tokens: 11648, cache_read_input_tokens: 12693, output_tokens: 14 },
  session_id: SID,
  uuid: 'res-uuid',
}
const CAN_USE_TOOL = {
  type: 'control_request',
  request_id: 'req-1',
  request: {
    subtype: 'can_use_tool',
    tool_name: 'Bash',
    input: { command: 'git push' },
    tool_use_id: 'toolu_push',
    description: '\u001b[33mPush the branch\u001b[0m',
    decision_reason: 'Pushing affects shared state',
    permission_suggestions: [
      { type: 'addRules', behavior: 'allow', destination: 'localSettings', rules: [{ toolName: 'Bash', ruleContent: 'git push:*' }] },
      { type: 'setMode', mode: 'acceptEdits', destination: 'session' },
    ],
  },
}
const DELTA = {
  type: 'stream_event',
  event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi!' } },
  session_id: SID,
  parent_tool_use_id: null,
  uuid: 'd1',
  api_message_id: 'msg_011CgFFMkqpmchVUTazqyMKR',
}

describe('normalise', () => {
  it('maps system/init to a session event with failed MCP servers only', () => {
    const [e] = normalise(INIT, ctx())
    expect(e).toMatchObject({
      kind: 'session',
      claudeSessionId: SID,
      model: 'claude-haiku-5-5',
      cwd: '/wt',
      tools: ['Task', 'Bash', 'Read'],
      mcpFailed: ['broken'],
      threadId: 'main',
      seq: 0,
    })
  })

  it('emits a session event only when the session/model changes (init repeats per turn)', () => {
    const c = ctx()
    expect(normalise(INIT, c)).toHaveLength(1)
    expect(normalise(INIT, c)).toHaveLength(0)
    expect(normalise({ ...INIT, model: 'claude-sonnet-5-5' }, c)).toHaveLength(1)
  })

  it('ignores system/commands_changed — for events and for the session id', () => {
    expect(normalise(COMMANDS_CHANGED, ctx())).toEqual([])
    expect(conversationIdIn(COMMANDS_CHANGED)).toBeNull()
    expect(conversationIdIn(INIT)).toBe(SID)
    expect(conversationIdIn(ASSISTANT_TEXT)).toBe(SID)
    expect(conversationIdIn(RESULT)).toBe(SID)
    expect(conversationIdIn(TOOL_RESULT)).toBe(SID)
  })

  it('maps assistant text, using the line timestamp', () => {
    const [e] = normalise(ASSISTANT_TEXT, ctx())
    expect(e).toMatchObject({ kind: 'text', role: 'assistant', text: 'Hi! What can I help you with today?', at: '2026-10-21T10:46:31.997Z', uuid: 'a-uuid' })
  })

  it('maps thinking + tool_use blocks into separate events with distinct uuids', () => {
    const events = normalise(ASSISTANT_TOOL, ctx())
    expect(events.map((e) => e.kind)).toEqual(['thinking', 'tool', 'tool'])
    expect(events[1]).toMatchObject({ kind: 'tool', id: 'toolu_017o', name: 'Bash', input: { command: 'touch probe.txt' }, spawnsThread: false })
    expect(events[2]).toMatchObject({ kind: 'tool', name: 'Task', spawnsThread: true })
    expect(new Set(events.map((e) => e.uuid)).size).toBe(3)
    expect(events.map((e) => e.seq)).toEqual([0, 1, 2])
  })

  it('maps a user tool_result', () => {
    const [e] = normalise(TOOL_RESULT, ctx())
    expect(e).toMatchObject({ kind: 'tool-result', id: 'toolu_017o', ok: true, text: '(Bash completed with no output)' })
    const [err] = normalise(
      { ...TOOL_RESULT, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', is_error: true, content: [{ type: 'text', text: 'boom' }] }] } },
      ctx()
    )
    expect(err).toMatchObject({ ok: false, text: 'boom' })
  })

  it('threads sub-agent messages under parent_tool_use_id', () => {
    const [e] = normalise(SUBAGENT, ctx())
    expect(e).toMatchObject({ kind: 'text', threadId: 'toolu_task' })
  })

  it('maps result with cost, duration and usage', () => {
    const [e] = normalise(RESULT, ctx())
    expect(e).toMatchObject({
      kind: 'result',
      ok: true,
      costUsd: 0.0024,
      durationMs: 3456,
      usage: { input: 2, output: 14, cacheRead: 12693, cacheWrite: 11648 },
      text: 'Hi!',
    })
    const [bad] = normalise({ ...RESULT, is_error: true, result: 'Invalid API key' }, ctx())
    expect(bad).toMatchObject({ ok: false })
  })

  it('maps control_request can_use_tool to an ask (ANSI stripped, always offered)', () => {
    const [e] = normalise(CAN_USE_TOOL, ctx())
    expect(e).toMatchObject({
      kind: 'ask',
      id: 'req-1',
      tool: 'Bash',
      input: { command: 'git push' },
      toolUseId: 'toolu_push',
      description: 'Push the branch',
      reason: 'Pushing affects shared state',
      canAlwaysAllow: true,
    })
    const req = permissionRequestIn(CAN_USE_TOOL)!
    // setMode suggestions are never part of an "always".
    expect(req.grants).toEqual([{ toolName: 'Bash', ruleContent: 'git push:*' }])
    const [noAlways] = normalise(
      { ...CAN_USE_TOOL, request: { ...CAN_USE_TOOL.request, suppress_always_allow_rule: true } },
      ctx()
    )
    expect(noAlways).toMatchObject({ canAlwaysAllow: false })
  })

  it('ignores other control requests and our own non-permission control responses', () => {
    expect(normalise({ type: 'control_request', request_id: 'x', request: { subtype: 'interrupt' } }, ctx())).toEqual([])
    expect(normalise({ type: 'control_response', response: { subtype: 'success', request_id: 'i1', response: { still_queued: [] } } }, ctx())).toEqual([])
  })

  it('reads ask decisions back off our control_response frames', () => {
    const req = permissionRequestIn(CAN_USE_TOOL)!
    const decisionOf = (frame: string) => (normalise(JSON.parse(frame), ctx())[0] as any)?.decision
    expect(decisionOf(permissionResponseFrame(req, 'allow'))).toBe('allow')
    expect(decisionOf(permissionResponseFrame(req, 'always'))).toBe('always')
    expect(decisionOf(permissionResponseFrame(req, 'deny'))).toBe('deny')
  })

  it('classifies Claude-authored user messages as notes', () => {
    const userLine = (text: string, extra: Record<string, unknown> = {}) => ({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text }] },
      parent_tool_use_id: null,
      ...extra,
    })
    expect(normalise(userLine('[Request interrupted by user]'), ctx())[0]).toMatchObject({ kind: 'note', source: 'interrupt' })
    expect(
      normalise({ type: 'user', message: { role: 'user', content: '<local-command-stdout>Set model to `x`</local-command-stdout>' }, isReplay: true }, ctx())[0]
    ).toMatchObject({ kind: 'note', source: 'command-output' })
    expect(normalise(userLine('Base directory for this skill: /x/skills/foo\n\n# Foo', { isSynthetic: true }), ctx())[0]).toMatchObject({
      kind: 'note',
      source: 'skill',
      label: 'Loaded skill foo',
    })
    expect(normalise(userLine('why does <system-reminder> show up?'), ctx())[0]).toMatchObject({ kind: 'text', role: 'user' })
    // Our own outgoing frame replays as the person's message.
    expect(normalise(JSON.parse(userMessageFrame('say hi')), ctx())[0]).toMatchObject({ kind: 'text', role: 'user', text: 'say hi' })
  })

  it('flags replayed events', () => {
    const [e] = normalise(ASSISTANT_TEXT, ctx({ replayed: true }))
    expect(e.replayed).toBe(true)
    expect(normalise(ASSISTANT_TEXT, ctx())[0].replayed).toBeUndefined()
  })

  it('drops stream_event partials from events but exposes text deltas', () => {
    expect(normalise(DELTA, ctx())).toEqual([])
    expect(partialDeltaIn(DELTA)).toEqual({ messageId: 'msg_011CgFFMkqpmchVUTazqyMKR', threadId: 'main', text: 'Hi!' })
    expect(partialDeltaIn({ ...DELTA, event: { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{' } } })).toBeNull()
    expect(partialDeltaIn({ ...DELTA, event: { type: 'message_start' } })).toBeNull()
    expect(partialDeltaIn({ ...DELTA, parent_tool_use_id: 'toolu_task' })?.threadId).toBe('toolu_task')
    expect(assistantMessageIdIn(ASSISTANT_TEXT)).toBe('msg_011CgFFMkqpmchVUTazqyMKR')
  })

  it('reads usage, control responses, and drops unknown lines', () => {
    expect(usageIn(ASSISTANT_TEXT)).toEqual({ input: 2, output: 14, cacheRead: 12693, cacheWrite: 11648 })
    expect(controlResponseIn({ type: 'control_response', response: { subtype: 'error', request_id: 'm1', error: 'nope' } })).toEqual({ requestId: 'm1', ok: false, error: 'nope' })
    expect(normalise({ type: 'rate_limit_event' }, ctx())).toEqual([])
    expect(normalise('garbage', ctx())).toEqual([])
  })
})

describe('lineReader', () => {
  it('reassembles lines split across chunks and reports noise', () => {
    const lines: unknown[] = []
    const noise: string[] = []
    const r = lineReader((v) => lines.push(v), (n) => noise.push(n))
    r.push('{"a":1}\n{"b"')
    r.push(':2}\nwarning: x\n{"c":3}')
    r.flush()
    expect(lines).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }])
    expect(noise).toEqual(['warning: x'])
  })
})

describe('launch argv', () => {
  const FORBIDDEN = ['--permission-mode', '--dangerously-skip-permissions', 'acceptEdits', 'bypassPermissions', 'dontAsk']

  it('main argv speaks stream-json both ways with partials and the stdio prompt tool, and never sets a permission mode', () => {
    const argv = agentArgv({ model: 'claude-opus-5-5' })
    expect(argv.slice(0, 6)).toEqual(['-p', '--output-format', 'stream-json', '--input-format', 'stream-json', '--verbose'])
    expect(argv).toContain('--include-partial-messages')
    expect(argv).toContain('--forward-subagent-text')
    expect(argv[argv.indexOf('--permission-prompt-tool') + 1]).toBe('stdio')
    expect(argv[argv.indexOf('--model') + 1]).toBe('claude-opus-5-5')
    expect(argv).not.toContain('--resume')
    for (const f of FORBIDDEN) expect(argv).not.toContain(f)
  })

  it('adds --resume and validates the model', () => {
    const argv = agentArgv({ model: 'claude-opus-5-5[1m]', resume: SID })
    expect(argv[argv.indexOf('--resume') + 1]).toBe(SID)
    expect(argv[argv.indexOf('--model') + 1]).toBe('claude-opus-5-5[1m]')
    expect(agentArgv({ model: 'opus; rm -rf /' })).toContain('claude-opus-5-5')
    expect(isValidModel('claude-sonnet-5-5')).toBe(true)
    expect(isValidModel('gpt-4')).toBe(false)
    expect(isValidModel('claude-x[2m]')).toBe(false)
    expect(resolveModel(undefined)).toBe('claude-opus-5-5')
  })

  it('fork argv resumes + forks with no tools, strict MCP, and no permission flags', () => {
    const argv = forkArgv({ parentSessionId: SID, forkSessionId: 'f-uuid', model: 'claude-sonnet-5-5' })
    expect(argv[argv.indexOf('--resume') + 1]).toBe(SID)
    expect(argv).toContain('--fork-session')
    expect(argv[argv.indexOf('--session-id') + 1]).toBe('f-uuid')
    expect(argv[argv.indexOf('--tools') + 1]).toBe('')
    expect(argv).toContain('--strict-mcp-config')
    expect(argv[argv.indexOf('--model') + 1]).toBe('claude-sonnet-5-5')
    expect(argv).not.toContain('--permission-prompt-tool')
    expect(argv).not.toContain('--include-partial-messages')
    for (const f of FORBIDDEN) expect(argv).not.toContain(f)
  })
})

describe('stdin frames', () => {
  const req = permissionRequestIn(CAN_USE_TOOL)!

  it('user message frame', () => {
    const frame = userMessageFrame('hello')
    expect(frame.endsWith('\n')).toBe(true)
    expect(JSON.parse(frame)).toEqual({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      parent_tool_use_id: null,
    })
  })

  it('allow echoes the input and adds no rules', () => {
    expect(JSON.parse(permissionResponseFrame(req, 'allow'))).toEqual({
      type: 'control_response',
      response: { subtype: 'success', request_id: 'req-1', response: { behavior: 'allow', updatedInput: { command: 'git push' } } },
    })
  })

  it('always rewrites the destination to session (never localSettings)', () => {
    const parsed = JSON.parse(permissionResponseFrame(req, 'always'))
    expect(parsed.response.response.updatedPermissions).toEqual([
      { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'git push:*' }], behavior: 'allow', destination: 'session' },
    ])
    expect(JSON.stringify(parsed)).not.toContain('localSettings')
    // A request that forbids standing rules degrades to a plain allow.
    const noRule = JSON.parse(permissionResponseFrame({ ...req, noStandingRule: true }, 'always'))
    expect(noRule.response.response.updatedPermissions).toBeUndefined()
  })

  it('deny carries a message and the tool use id', () => {
    expect(JSON.parse(permissionResponseFrame(req, 'deny')).response.response).toEqual({
      behavior: 'deny',
      message: 'Denied from CodeCrucible.',
      toolUseID: 'toolu_push',
    })
  })

  it('AskUserQuestion answers ride on updatedInput.answers', () => {
    const q = { ...req, tool: 'AskUserQuestion', input: { questions: [{ question: 'Which DB?' }] } }
    expect(JSON.parse(questionAnswerFrame(q, { 'Which DB?': 'Postgres' })).response.response).toEqual({
      behavior: 'allow',
      updatedInput: { questions: [{ question: 'Which DB?' }], answers: { 'Which DB?': 'Postgres' } },
    })
  })

  it('control request frames', () => {
    expect(JSON.parse(interruptFrame('i1'))).toEqual({ type: 'control_request', request_id: 'i1', request: { subtype: 'interrupt' } })
    expect(JSON.parse(setModelFrame('m1', 'claude-haiku-5-5'))).toEqual({
      type: 'control_request',
      request_id: 'm1',
      request: { subtype: 'set_model', model: 'claude-haiku-5-5' },
    })
    expect(sideQuestionPreamble('why?').endsWith('\nwhy?')).toBe(true)
  })
})
