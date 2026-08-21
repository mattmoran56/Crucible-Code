import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '../../../src/shared/constants'
import type { OverseerState } from '../../../src/shared/types'

/**
 * Covers the Overseer agent loop as it actually behaves: the write gate that
 * refuses tool-permission prompts, the heartbeat that skips the API when
 * nothing changed, the daily cost cap, and the tool_use/tool_result pairing
 * that keeps a conversation replayable after a tool throws.
 *
 * Everything the service touches is faked — the Anthropic client, the IPC
 * registry, the terminal service, electron-store — so no network, no disk and
 * no Electron.
 */

// ── fakes ───────────────────────────────────────────────────────────────────

type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }

interface FakeResponse {
  content: Block[]
  stop_reason: 'end_turn' | 'tool_use'
  usage: { input_tokens: number; output_tokens: number }
}

const hoisted = vi.hoisted(() => {
  const h: any = {
    /** Queued responses the fake Anthropic client hands back, in order. */
    responses: [] as unknown[],
    /** Every request the service made. */
    requests: [] as Array<Record<string, unknown>>,
    createImpl: null as null | (() => never),
    terminalBuffer: '',
    terminals: [] as Array<{ terminalId: string; mode: string; tabId: string; contextId: string }>,
    injected: [] as Array<{ terminalId: string; prompt: string }>,
    statuses: new Map<string, string>(),
    projects: [] as Array<Record<string, unknown>>,
    sessions: new Map<string, Array<Record<string, unknown>>>(),
    invokeCalls: [] as Array<{ channel: string; args: unknown[] }>,
    worktreeCalls: [] as Array<{ repoPath: string; name: string; baseBranch?: string }>,
    sent: [] as Array<{ channel: string; payload: unknown }>,
    /** Set to make the faked createWorktree reject with this message. */
    worktreeError: '' as string,
    apiKey: 'sk-ant-test',
  }

  h.FakeAnthropic = class {
    static lastApiKey: string | undefined
    messages: { create: (req: Record<string, unknown>) => Promise<unknown> }
    constructor(opts: { apiKey: string }) {
      h.FakeAnthropic.lastApiKey = opts.apiKey
      this.messages = {
        create: async (req: Record<string, unknown>) => {
          h.requests.push(req)
          if (h.createImpl) h.createImpl()
          const next = h.responses.shift()
          if (!next) throw new Error('fake client ran out of queued responses')
          return next
        },
      }
    }
  }

  // In-memory replacement for electron-store: same minimal get/set surface,
  // no disk.
  h.FakeStore = class {
    private state: Record<string, unknown>
    constructor(opts: { defaults: Record<string, unknown> }) {
      this.state = JSON.parse(JSON.stringify(opts.defaults))
    }
    get(key: string, defaultValue?: unknown): unknown {
      return this.state[key] ?? defaultValue
    }
    set(key: string, value: unknown): void {
      this.state[key] = value
    }
  }

  return h
})

vi.mock('@anthropic-ai/sdk', () => ({ default: hoisted.FakeAnthropic }))
vi.mock('electron-store', () => ({ default: hoisted.FakeStore }))
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/cc-test', isPackaged: false } }))
vi.mock('../../../src/main/store-path', () => ({ getStorePath: () => '/tmp/cc-test' }))

vi.mock('../../../src/main/ipc/handle', () => ({
  invokeHandler: async (channel: string, args: unknown[]) => {
    hoisted.invokeCalls.push({ channel, args })
    if (channel === IPC.PROJECT_LIST) return hoisted.projects
    if (channel === IPC.SESSION_LIST) return hoisted.sessions.get(args[0] as string) ?? []
    if (channel === IPC.SESSION_SAVE) {
      hoisted.sessions.set(args[0] as string, args[1] as Array<Record<string, unknown>>)
      return undefined
    }
    if (channel === IPC.ACCOUNT_LIST) return []
    if (channel === IPC.TERMINAL_SPAWN) return 'term-new'
    return undefined
  },
}))

vi.mock('../../../src/main/services/terminal.service', () => ({
  getTerminalBuffer: () => hoisted.terminalBuffer,
  getTerminalLastOutputAt: () => Date.now(),
  listTerminalsForSession: (sessionId: string) =>
    hoisted.terminals.filter((t) => t.contextId === sessionId),
  injectPrompt: async (terminalId: string, prompt: string) => {
    hoisted.injected.push({ terminalId, prompt })
  },
}))

vi.mock('../../../src/main/services/session-status.service', () => ({
  getSessionStatus: (id: string) => hoisted.statuses.get(id),
}))

vi.mock('../../../src/main/services/worktree.service', () => ({
  createWorktree: async (repoPath: string, name: string, baseBranch?: string) => {
    if (hoisted.worktreeError) throw new Error(hoisted.worktreeError)
    hoisted.worktreeCalls.push({ repoPath, name, baseBranch })
    return { path: `/worktrees/${name}`, branch: `session/${name}` }
  },
}))

import * as overseer from '../../../src/main/services/overseer.service'

// ── helpers ─────────────────────────────────────────────────────────────────

const fakeWindow = {
  isDestroyed: () => false,
  webContents: {
    send: (channel: string, payload: unknown) => {
      hoisted.sent.push({ channel, payload })
    },
  },
} as unknown as Electron.BrowserWindow

function text(t: string): FakeResponse {
  return {
    content: [{ type: 'text', text: t }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 100, output_tokens: 50 },
  }
}

function toolUse(name: string, input: Record<string, unknown> = {}): FakeResponse {
  return {
    content: [{ type: 'tool_use', id: `tu-${name}`, name, input }],
    stop_reason: 'tool_use',
    usage: { input_tokens: 100, output_tokens: 50 },
  }
}

/** The single agent terminal fixture most tests want. */
function giveSessionATerminal(sessionId = 's1') {
  hoisted.terminals = [
    { terminalId: 't1', mode: 'claude', tabId: 'agent', contextId: sessionId },
  ]
}

function lastAssistant(state: OverseerState): string {
  const assistant = state.messages.filter((m) => m.role === 'assistant')
  return assistant[assistant.length - 1]?.content ?? ''
}

/**
 * Every tool_result the service handed back to the model, deduped by
 * tool_use_id — history is replayed on each request, so a naive scan would
 * count the same result once per subsequent turn.
 */
function toolResultsSentBack(): Array<{
  tool_use_id: string
  is_error?: boolean
  content?: unknown
}> {
  const byId = new Map<string, { tool_use_id: string; is_error?: boolean; content?: unknown }>()
  for (const req of hoisted.requests) {
    for (const msg of (req.messages ?? []) as Array<{ role: string; content: unknown }>) {
      if (!Array.isArray(msg.content)) continue
      for (const block of msg.content as Array<Record<string, unknown>>) {
        if (block.type !== 'tool_result') continue
        const id = String(block.tool_use_id)
        if (!byId.has(id)) byId.set(id, block as never)
      }
    }
  }
  return [...byId.values()]
}

beforeEach(() => {
  hoisted.responses = []
  hoisted.requests = []
  hoisted.createImpl = null
  hoisted.terminalBuffer = 'previous output\n> '
  hoisted.terminals = []
  hoisted.injected = []
  hoisted.statuses = new Map()
  hoisted.invokeCalls = []
  hoisted.worktreeCalls = []
  hoisted.worktreeError = ''
  hoisted.sent = []
  hoisted.projects = [{ id: 'p1', name: 'Crucible', repoPath: '/repo' }]
  hoisted.sessions = new Map([
    ['p1', [{ id: 's1', name: 'auth-refresh', branchName: 'session/auth', projectId: 'p1' }]],
  ])

  overseer.stopOverseer()
  overseer.setOverseerWindow(fakeWindow)
  overseer.clearConversation()
  overseer.setSettings({
    ...overseer.DEFAULT_SETTINGS,
    apiKey: hoisted.apiKey,
    allowWrites: true,
    heartbeatEnabled: false,
  })
})

// ── settings ────────────────────────────────────────────────────────────────

describe('settings', () => {
  it('defaults to the cheapest model, writes off, heartbeat off', () => {
    expect(overseer.DEFAULT_SETTINGS.model).toBe('claude-haiku-4-5')
    expect(overseer.DEFAULT_SETTINGS.allowWrites).toBe(false)
    expect(overseer.DEFAULT_SETTINGS.heartbeatEnabled).toBe(false)
  })

  it('clamps the heartbeat interval to a sane floor', () => {
    const saved = overseer.setSettings({ heartbeatSeconds: 1 })
    expect(saved.heartbeatSeconds).toBe(30)
  })

  it('clamps tool rounds so a confused turn cannot loop up a bill', () => {
    expect(overseer.setSettings({ maxIterations: 0 }).maxIterations).toBe(1)
    expect(overseer.setSettings({ maxIterations: 999 }).maxIterations).toBe(40)
  })

  it('uses the configured model for the request', async () => {
    overseer.setSettings({ model: 'claude-sonnet-5' })
    hoisted.responses = [text('hi')]
    await overseer.sendUserMessage('hello')
    expect(hoisted.requests[0].model).toBe('claude-sonnet-5')
  })

  it('never sends thinking or effort, which not every model accepts', async () => {
    hoisted.responses = [text('hi')]
    await overseer.sendUserMessage('hello')
    expect(hoisted.requests[0]).not.toHaveProperty('thinking')
    expect(hoisted.requests[0]).not.toHaveProperty('output_config')
  })
})

// ── conversation ────────────────────────────────────────────────────────────

describe('conversation', () => {
  it('records the user turn and the reply', async () => {
    hoisted.responses = [text('Four sessions, none blocked.')]
    await overseer.sendUserMessage('what is going on?')

    const state = overseer.getState()
    expect(state.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(lastAssistant(state)).toBe('Four sessions, none blocked.')
    expect(state.running).toBe(false)
  })

  it('ignores an empty message without calling the API', async () => {
    await overseer.sendUserMessage('   ')
    expect(hoisted.requests).toHaveLength(0)
  })

  it('surfaces an API failure instead of throwing', async () => {
    hoisted.createImpl = () => {
      throw new Error('overloaded')
    }
    hoisted.responses = [text('unused')]
    await overseer.sendUserMessage('hello')

    const state = overseer.getState()
    expect(state.lastError).toContain('overloaded')
    expect(state.running).toBe(false)
  })

  it('refuses to run without an API key and says so', async () => {
    overseer.setSettings({ apiKey: '' })
    const previous = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY

    await overseer.sendUserMessage('hello')
    expect(overseer.getState().lastError).toMatch(/api key/i)
    expect(hoisted.requests).toHaveLength(0)

    if (previous) process.env.ANTHROPIC_API_KEY = previous
  })

  it('clears the thread on request', async () => {
    hoisted.responses = [text('hi')]
    await overseer.sendUserMessage('hello')
    expect(overseer.getState().messages.length).toBeGreaterThan(0)
    overseer.clearConversation()
    expect(overseer.getState().messages).toEqual([])
  })

  it('pushes state to the renderer as the pass progresses', async () => {
    hoisted.responses = [text('hi')]
    await overseer.sendUserMessage('hello')
    const updates = hoisted.sent.filter((s) => s.channel === IPC.OVERSEER_STATE_UPDATE)
    expect(updates.length).toBeGreaterThan(1)
  })
})

// ── tools ───────────────────────────────────────────────────────────────────

describe('list_sessions', () => {
  it('returns every session with a status and signals', async () => {
    giveSessionATerminal()
    hoisted.statuses.set('s1', 'attention')
    hoisted.terminalBuffer = 'Which database would you prefer?'

    const snapshot = await overseer.buildSnapshot()
    expect(snapshot).toHaveLength(1)
    expect(snapshot[0]).toMatchObject({
      sessionId: 's1',
      name: 'auth-refresh',
      projectName: 'Crucible',
      status: 'attention',
      hasAgentTerminal: true,
    })
    expect(snapshot[0].signals).toContain('waiting-question')
  })

  it('marks a session with no live terminal', async () => {
    const snapshot = await overseer.buildSnapshot()
    expect(snapshot[0].hasAgentTerminal).toBe(false)
    expect(snapshot[0].signals).toEqual(['no-agent-terminal'])
    expect(snapshot[0].status).toBe('idle')
  })

  it('flags a permission block distinctly from a question', async () => {
    giveSessionATerminal()
    hoisted.statuses.set('s1', 'attention')
    hoisted.terminalBuffer = 'Claude wants to run docker compose up\n1. Yes\n2. No'

    const snapshot = await overseer.buildSnapshot()
    expect(snapshot[0].signals).toContain('waiting-permission')
    expect(snapshot[0].signals).not.toContain('waiting-question')
  })

  it('can be narrowed to one project', async () => {
    hoisted.projects = [
      { id: 'p1', name: 'Crucible', repoPath: '/repo' },
      { id: 'p2', name: 'Relay', repoPath: '/relay' },
    ]
    hoisted.sessions.set('p2', [
      { id: 's2', name: 'flaky-e2e', branchName: 'session/flaky', projectId: 'p2' },
    ])

    expect(await overseer.buildSnapshot()).toHaveLength(2)
    expect(await overseer.buildSnapshot('p2')).toHaveLength(1)
  })
})

describe('send_message_to_session — the write gate', () => {
  it('types into a session sitting at an idle prompt', async () => {
    giveSessionATerminal()
    hoisted.terminalBuffer = 'all done\n> '
    hoisted.responses = [
      toolUse('send_message_to_session', { sessionId: 's1', message: 'use Redis' }),
      text('Told it to use Redis.'),
    ]

    await overseer.sendUserMessage('tell auth-refresh to use Redis')

    expect(hoisted.injected).toHaveLength(1)
    expect(hoisted.injected[0].prompt).toContain('use Redis')
  })

  it('prefixes what it types so the transcript shows who spoke', async () => {
    giveSessionATerminal()
    hoisted.responses = [
      toolUse('send_message_to_session', { sessionId: 's1', message: 'use Redis' }),
      text('done'),
    ]
    await overseer.sendUserMessage('go')
    expect(hoisted.injected[0].prompt.startsWith('[Overseer]')).toBe(true)
  })

  it('REFUSES to answer a tool-permission prompt', async () => {
    giveSessionATerminal()
    hoisted.terminalBuffer =
      'Claude wants to run rm -rf build\nDo you want to proceed?\n1. Yes\n2. No'
    hoisted.responses = [
      toolUse('send_message_to_session', { sessionId: 's1', message: '1' }),
      text('That one is yours to answer.'),
    ]

    await overseer.sendUserMessage('just approve it')

    expect(hoisted.injected).toHaveLength(0)
    const results = toolResultsSentBack()
    expect(results[0].is_error).toBe(true)
    expect(String(results[0].content)).toMatch(/permission/i)
  })

  it('refuses while the session is mid-turn rather than interrupting it', async () => {
    giveSessionATerminal()
    hoisted.terminalBuffer = 'Editing files… (esc to interrupt)'
    hoisted.responses = [
      toolUse('send_message_to_session', { sessionId: 's1', message: 'stop' }),
      text('It is busy.'),
    ]

    await overseer.sendUserMessage('interrupt it')
    expect(hoisted.injected).toHaveLength(0)
  })

  it('fails closed on a screen it cannot classify', async () => {
    giveSessionATerminal()
    hoisted.terminalBuffer = 'unstructured noise with no prompt'
    hoisted.responses = [
      toolUse('send_message_to_session', { sessionId: 's1', message: 'hello' }),
      text('Could not tell what it was showing.'),
    ]

    await overseer.sendUserMessage('message it')
    expect(hoisted.injected).toHaveLength(0)
  })

  it('refuses entirely when writes are disabled', async () => {
    overseer.setSettings({ allowWrites: false })
    giveSessionATerminal()
    hoisted.terminalBuffer = 'all done\n> '
    hoisted.responses = [
      toolUse('send_message_to_session', { sessionId: 's1', message: 'hi' }),
      text('Read-only.'),
    ]

    await overseer.sendUserMessage('message it')
    expect(hoisted.injected).toHaveLength(0)
    expect(String(toolResultsSentBack()[0].content)).toMatch(/read-only/i)
  })

  it('refuses an empty message', async () => {
    giveSessionATerminal()
    hoisted.responses = [
      toolUse('send_message_to_session', { sessionId: 's1', message: '  ' }),
      text('Nothing to send.'),
    ]
    await overseer.sendUserMessage('go')
    expect(hoisted.injected).toHaveLength(0)
  })

  it('reports a session with no live terminal', async () => {
    hoisted.responses = [
      toolUse('send_message_to_session', { sessionId: 's1', message: 'hi' }),
      text('No terminal.'),
    ]
    await overseer.sendUserMessage('go')
    expect(String(toolResultsSentBack()[0].content)).toMatch(/no live agent terminal/i)
  })
})

describe('start_session', () => {
  it('creates a worktree, persists the session and spawns an agent', async () => {
    hoisted.responses = [
      toolUse('start_session', {
        projectId: 'p1',
        name: 'flaky-billing',
        prompt: 'Fix the flaky billing test.',
      }),
      text('Started it.'),
    ]

    await overseer.sendUserMessage('spin up someone for the flaky billing test')

    expect(hoisted.worktreeCalls).toEqual([
      { repoPath: '/repo', name: 'flaky-billing', baseBranch: undefined },
    ])
    const saved = hoisted.sessions.get('p1')!
    expect(saved).toHaveLength(2)
    expect(saved[0]).toMatchObject({ name: 'flaky-billing', branchName: 'session/flaky-billing' })
  })

  it('spawns through the IPC handler so hooks and permissions are seeded', async () => {
    hoisted.responses = [
      toolUse('start_session', { projectId: 'p1', name: 'x', prompt: 'do it' }),
      text('ok'),
    ]
    await overseer.sendUserMessage('go')

    const spawn = hoisted.invokeCalls.find((c) => c.channel === IPC.TERMINAL_SPAWN)
    expect(spawn).toBeDefined()
    expect(spawn!.args[2]).toBe('claude')
  })

  it('registers the new session for hook routing', async () => {
    hoisted.responses = [
      toolUse('start_session', { projectId: 'p1', name: 'x', prompt: 'do it' }),
      text('ok'),
    ]
    await overseer.sendUserMessage('go')
    expect(
      hoisted.invokeCalls.some((c) => c.channel === 'notification:register-session')
    ).toBe(true)
  })

  it('tells the renderer to reload so the session appears in the sidebar', async () => {
    hoisted.responses = [
      toolUse('start_session', { projectId: 'p1', name: 'x', prompt: 'do it' }),
      text('ok'),
    ]
    await overseer.sendUserMessage('go')
    expect(hoisted.sent.some((s) => s.channel === IPC.OVERSEER_SESSIONS_CHANGED)).toBe(true)
  })

  it('rejects an unknown project without creating anything', async () => {
    hoisted.responses = [
      toolUse('start_session', { projectId: 'nope', name: 'x', prompt: 'y' }),
      text('No such project.'),
    ]
    await overseer.sendUserMessage('go')
    expect(hoisted.worktreeCalls).toHaveLength(0)
    expect(String(toolResultsSentBack()[0].content)).toMatch(/no project/i)
  })

  it('rejects a duplicate session name', async () => {
    hoisted.responses = [
      toolUse('start_session', { projectId: 'p1', name: 'auth-refresh', prompt: 'y' }),
      text('Already exists.'),
    ]
    await overseer.sendUserMessage('go')
    expect(hoisted.worktreeCalls).toHaveLength(0)
    expect(String(toolResultsSentBack()[0].content)).toMatch(/already exists/i)
  })

  it('sanitises a name that would be an unsafe branch', async () => {
    hoisted.responses = [
      toolUse('start_session', { projectId: 'p1', name: 'a b;rm -rf /', prompt: 'y' }),
      text('ok'),
    ]
    await overseer.sendUserMessage('go')
    expect(hoisted.worktreeCalls[0].name).not.toMatch(/[; ]/)
  })

  it('does not create sessions when writes are disabled', async () => {
    overseer.setSettings({ allowWrites: false })
    hoisted.responses = [
      toolUse('start_session', { projectId: 'p1', name: 'x', prompt: 'y' }),
      text('Read-only.'),
    ]
    await overseer.sendUserMessage('go')
    expect(hoisted.worktreeCalls).toHaveLength(0)
  })
})

describe('report_to_user', () => {
  it('posts into the thread flagged as needing attention', async () => {
    hoisted.responses = [
      toolUse('report_to_user', { summary: 'flaky-e2e is blocked.', needsAttention: true }),
      text('quiet'),
    ]
    await overseer.sendUserMessage('check')

    const reported = overseer.getState().messages.find((m) => m.needsAttention)
    expect(reported?.content).toBe('flaky-e2e is blocked.')
  })

  it('ignores an empty report', async () => {
    hoisted.responses = [toolUse('report_to_user', { summary: '  ' }), text('done')]
    await overseer.sendUserMessage('check')
    expect(overseer.getState().messages.some((m) => m.content.trim() === '')).toBe(false)
  })
})

// ── the loop itself ─────────────────────────────────────────────────────────

describe('agent loop', () => {
  it('answers every tool_use with a tool_result, even when the tool throws', async () => {
    // An unanswered tool_use would make the NEXT turn a 400.
    hoisted.responses = [
      toolUse('start_session', { projectId: 'p1', name: 'boom', prompt: 'x' }),
      text('recovered'),
    ]
    hoisted.worktreeError = 'git exploded'

    await overseer.sendUserMessage('go')

    const results = toolResultsSentBack()
    expect(results).toHaveLength(1)
    expect(results[0].is_error).toBe(true)
    expect(String(results[0].content)).toContain('git exploded')
    expect(overseer.getState().lastError).toBeUndefined()
  })

  it('reports an unknown tool rather than silently succeeding', async () => {
    hoisted.responses = [toolUse('delete_everything'), text('no such tool')]
    await overseer.sendUserMessage('go')
    const results = toolResultsSentBack()
    expect(results[0].is_error).toBe(true)
    expect(String(results[0].content)).toMatch(/unknown tool/i)
  })

  it('stops after the configured number of tool rounds', async () => {
    overseer.setSettings({ maxIterations: 3 })
    hoisted.responses = Array.from({ length: 10 }, () => toolUse('list_sessions'))
    await overseer.sendUserMessage('go')

    expect(hoisted.requests).toHaveLength(3)
    expect(
      overseer.getState().messages.some((m) => m.role === 'system' && /3 tool rounds/.test(m.content))
    ).toBe(true)
  })

  it('records each tool call in the activity trail', async () => {
    hoisted.responses = [toolUse('list_sessions'), text('done')]
    await overseer.sendUserMessage('go')
    const toolMessages = overseer.getState().messages.filter((m) => m.role === 'tool')
    expect(toolMessages).toHaveLength(1)
    expect(toolMessages[0].toolName).toBe('list_sessions')
    expect(toolMessages[0].toolOk).toBe(true)
  })
})

// ── cost ────────────────────────────────────────────────────────────────────

describe('cost control', () => {
  it('accumulates spend from reported usage', async () => {
    hoisted.responses = [text('hi')]
    await overseer.sendUserMessage('hello')
    expect(overseer.getState().spendTodayUsd).toBeGreaterThan(0)
  })

  it('stops passes once the daily cap is crossed', async () => {
    overseer.setSettings({ dailyCostCapUsd: 0 })
    hoisted.responses = [text('should not run')]
    await overseer.sendUserMessage('hello')

    expect(hoisted.requests).toHaveLength(0)
    expect(overseer.getState().lastError).toMatch(/cap/i)
  })
})

// ── heartbeat ───────────────────────────────────────────────────────────────

describe('heartbeat', () => {
  it('does nothing when disabled', async () => {
    overseer.setSettings({ heartbeatEnabled: false })
    await overseer.heartbeatTick()
    expect(hoisted.requests).toHaveLength(0)
  })

  it('spends a call the first time it sees the fleet', async () => {
    overseer.setSettings({ heartbeatEnabled: true })
    hoisted.responses = [text('quiet')]
    await overseer.heartbeatTick()
    expect(hoisted.requests).toHaveLength(1)
  })

  it('SKIPS the API entirely when nothing changed — a quiet fleet is free', async () => {
    overseer.setSettings({ heartbeatEnabled: true })
    hoisted.responses = [text('quiet')]
    await overseer.heartbeatTick()
    expect(hoisted.requests).toHaveLength(1)

    await overseer.heartbeatTick()
    await overseer.heartbeatTick()
    expect(hoisted.requests).toHaveLength(1)
  })

  it('wakes up when a session changes status', async () => {
    overseer.setSettings({ heartbeatEnabled: true })
    hoisted.responses = [text('quiet'), text('auth-refresh needs you')]
    await overseer.heartbeatTick()

    hoisted.statuses.set('s1', 'attention')
    await overseer.heartbeatTick()
    expect(hoisted.requests).toHaveLength(2)
  })

  it('runs on demand even when nothing changed', async () => {
    overseer.setSettings({ heartbeatEnabled: true })
    hoisted.responses = [text('quiet'), text('still quiet')]
    await overseer.heartbeatTick()
    await overseer.heartbeatTick(true)
    expect(hoisted.requests).toHaveLength(2)
  })

  it('marks its own messages so the panel can label them', async () => {
    overseer.setSettings({ heartbeatEnabled: true })
    hoisted.responses = [text('auth-refresh is blocked')]
    await overseer.heartbeatTick()

    const assistant = overseer.getState().messages.filter((m) => m.role === 'assistant')
    expect(assistant[assistant.length - 1].fromHeartbeat).toBe(true)
  })

  it('does not put the heartbeat prompt itself in the thread', async () => {
    overseer.setSettings({ heartbeatEnabled: true })
    hoisted.responses = [text('quiet')]
    await overseer.heartbeatTick()
    expect(overseer.getState().messages.some((m) => m.role === 'user')).toBe(false)
  })

  it('stamps the time even on a skipped tick, so the UI can show liveness', async () => {
    overseer.setSettings({ heartbeatEnabled: true })
    hoisted.responses = [text('quiet')]
    await overseer.heartbeatTick()
    await overseer.heartbeatTick()
    expect(overseer.getState().lastHeartbeatAt).toBeTruthy()
  })
})

// ── unread ──────────────────────────────────────────────────────────────────

describe('unread tracking', () => {
  it('counts assistant messages and clears on read', async () => {
    hoisted.responses = [text('hi')]
    await overseer.sendUserMessage('hello')
    expect(overseer.getState().unread).toBeGreaterThan(0)

    overseer.markRead()
    expect(overseer.getState().unread).toBe(0)
  })
})
