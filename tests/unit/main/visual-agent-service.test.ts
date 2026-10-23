// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const h = vi.hoisted(() => {
  const s: any = { spawnCalls: [], children: [], frames: [], hooks: [], userData: '' }
  s.makeChild = () => {
    const listeners: Record<string, Function[]> = {}
    const on = (key: string) => (e: string, cb: Function) => ((listeners[`${key}${e}`] ??= []).push(cb))
    const child: any = {
      pid: s.nextPid === undefined ? 4242 : s.nextPid,
      killed: false,
      exitCode: null,
      signalCode: null,
      stdout: { on: on('stdout:') },
      stderr: { on: on('stderr:') },
      stdin: { write: vi.fn(), end: vi.fn(), on: vi.fn() },
      on: on(''),
      kill: vi.fn(),
      writes: () => child.stdin.write.mock.calls.map((c: any[]) => JSON.parse(c[0])),
      _line: (obj: unknown) => (listeners['stdout:data'] ?? []).forEach((f) => f(Buffer.from(`${JSON.stringify(obj)}\n`))),
      _stderr: (text: string) => (listeners['stderr:data'] ?? []).forEach((f) => f(Buffer.from(text))),
      _emit: (e: string, ...args: unknown[]) => (listeners[e] ?? []).forEach((f) => f(...args)),
      _exit: (code: number | null, signal: string | null = null) => {
        child.exitCode = code
        child.signalCode = signal
        ;(listeners['exit'] ?? []).forEach((f) => f(code, signal))
      },
    }
    return child
  }
  return s
})

vi.mock('node:child_process', () => {
  const spawn = (file: string, args: string[], opts: any) => {
    h.spawnCalls.push({ file, args, opts })
    const child = h.makeChild()
    h.children.push(child)
    return child
  }
  return { spawn, default: { spawn } }
})
vi.mock('electron', () => {
  const app = { getPath: () => h.userData }
  return { app, default: { app } }
})
vi.mock('../../../src/main/services/terminal.service', () => ({ AUTO_PERMISSION_MODE_ARGS: [] }))
vi.mock('../../../src/main/services/claude-headless.service', () => ({
  killChildTree: vi.fn((child: any) => child._exit(null, 'SIGTERM')),
}))
vi.mock('../../../src/main/services/hook.service', () => ({ writeClaudeHookSettings: vi.fn() }))
vi.mock('../../../src/main/services/event-bus', () => ({
  emitToRenderer: (_w: unknown, channel: string, agentId: string, frame: unknown) =>
    h.frames.push({ channel, agentId, frame }),
}))

vi.mock('../../../src/main/services/notification-server', () => ({
  VISUAL_AGENT_HOOK_TAB: '__visual-agent__',
  handleHookEvent: (contextId: string, tabId: string, hookType: string) => h.hooks.push({ contextId, tabId, hookType }),
}))

import * as svc from '../../../src/main/services/visual-agent/visual-agent.service'
import { writeClaudeHookSettings } from '../../../src/main/services/hook.service'

const SID = '14b03bfe-3bf5-4a09-adb1-896839d8a45d'
const root = mkdtempSync(join(tmpdir(), 'va-test-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const baseOpts = (over: Record<string, unknown> = {}) => ({
  agentId: 'agent-1',
  sessionId: 'session-1',
  cwd: '/wt',
  repoPath: '/repo',
  ...over,
})
const frames = (t?: string) => h.frames.map((f: any) => f.frame).filter((f: any) => !t || f.t === t)
const events = () => frames('event').map((f: any) => f.event)
const lastChild = () => h.children[h.children.length - 1]
const flush = () => new Promise((r) => setTimeout(r, 20))

const init = (model = 'claude-opus-5-5') => ({ type: 'system', subtype: 'init', session_id: SID, model, cwd: '/wt', tools: [], mcp_servers: [] })
const result = { type: 'result', subtype: 'success', is_error: false, session_id: SID, total_cost_usd: 0.01, duration_ms: 5 }

beforeEach(() => {
  svc.__resetVisualAgentsForTest()
  h.spawnCalls = []
  h.children = []
  h.frames = []
  h.hooks = []
  h.nextPid = undefined
  h.userData = mkdtempSync(join(root, 'ud-'))
  vi.mocked(writeClaudeHookSettings).mockClear()
})

describe('visual agent service', () => {
  it('spawns claude with the stream-json argv, preps the worktree, and never sets a permission mode', async () => {
    const snap = await svc.startVisualAgent(baseOpts({ claudeConfigDir: '~/.claude-personal' }))
    expect(snap).toMatchObject({ agentId: 'agent-1', model: 'claude-opus-5-5', state: 'idle', events: [] })
    const { file, args, opts } = h.spawnCalls[0]
    expect(file).toBe('claude')
    expect(args).toContain('--input-format')
    expect(args).toContain('--include-partial-messages')
    expect(args.join(' ')).not.toMatch(/--permission-mode|--dangerously-skip-permissions|acceptEdits|bypassPermissions/)
    expect(opts.cwd).toBe('/wt')
    expect(opts.env.CLAUDE_CONFIG_DIR).not.toMatch(/^~/)
    expect(opts.env.CLAUDE_CONFIG_DIR).toMatch(/\.claude-personal$/)
    expect(opts.env.CRUCIBLE_CONTEXT_ID).toBe('session-1')
    // Hook calls from the process are tagged with the sentinel tab the
    // notification server drops; status comes from the run state instead.
    expect(opts.env.CRUCIBLE_TAB_ID).toBe('__visual-agent__')
    expect(writeClaudeHookSettings).toHaveBeenCalledWith('/wt', 'dark', 'session-1')
  })

  it('is ready to type straight away: idle without waiting for an init line, which only follows the first message', async () => {
    const snap = await svc.startVisualAgent(baseOpts())
    expect(snap.state).toBe('idle')
    expect(frames('state').at(-1)).toMatchObject({ state: 'idle' })
    // Nothing has been read from stdout and no 'spawn' event has fired; the
    // only write is the handshake asking for the slash commands.
    expect(lastChild().writes()).toEqual([
      { type: 'control_request', request_id: expect.stringMatching(/^crucible-initialize-/), request: { subtype: 'initialize' } },
    ])
  })

  it('reports the slash commands the CLI offers, outside the conversation', async () => {
    await svc.startVisualAgent(baseOpts())
    const c = lastChild()
    const requestId = c.writes()[0].request_id
    c._line({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: requestId,
        response: {
          commands: [
            { name: 'deploy', description: 'Deploy the thing (project)', argumentHint: '<env>' },
            { name: 'compact', description: 'Compact', argumentHint: '', builtin: true },
            { name: '__internal', description: '', argumentHint: '', builtin: true },
          ],
        },
      },
    })
    const expected = [
      { name: 'deploy', description: 'Deploy the thing (project)', argumentHint: '<env>', builtin: false },
      { name: 'compact', description: 'Compact', argumentHint: '', builtin: true },
    ]
    expect(frames('commands')).toEqual([{ t: 'commands', commands: expected }])
    expect(svc.getVisualAgentState('agent-1')?.commands).toEqual(expected)
    expect(events()).toEqual([])
    expect(frames('error')).toEqual([])

    // Skills found mid-session replace the list.
    c._line({ type: 'system', subtype: 'commands_changed', commands: [{ name: 'my-skill', description: 'A skill' }] })
    expect(svc.getVisualAgentState('agent-1')?.commands).toEqual([
      { name: 'my-skill', description: 'A skill', argumentHint: '', builtin: false },
    ])
  })

  it('a CLI that refuses the handshake keeps quiet and falls back to the names system/init lists', async () => {
    await svc.startVisualAgent(baseOpts())
    const c = lastChild()
    c._line({ type: 'control_response', response: { subtype: 'error', request_id: c.writes()[0].request_id, error: 'unknown' } })
    expect(frames('error')).toEqual([])
    svc.sendVisualAgentMessage('agent-1', 'hi')
    c._line({ ...init(), slash_commands: ['deploy', 'compact'] })
    expect(svc.getVisualAgentState('agent-1')?.commands?.map((x) => x.name)).toEqual(['deploy', 'compact'])
  })

  it('a spawn that fails (no pid, then an error) ends failed with an error row, never stuck starting', async () => {
    h.nextPid = null
    const snap = await svc.startVisualAgent(baseOpts())
    expect(snap.state).toBe('starting')
    lastChild()._emit('error', new Error('spawn claude ENOENT'))
    expect(frames('state').at(-1)).toMatchObject({ state: 'failed' })
    expect(events().some((e: any) => /Could not start Claude Code: spawn claude ENOENT/.test(JSON.stringify(e)))).toBe(true)
  })

  it('drops CLAUDE_CONFIG_DIR when none is provided', async () => {
    process.env.CLAUDE_CONFIG_DIR = '/elsewhere'
    await svc.startVisualAgent(baseOpts())
    expect('CLAUDE_CONFIG_DIR' in h.spawnCalls[0].opts.env).toBe(false)
    delete process.env.CLAUDE_CONFIG_DIR
  })

  it('is idempotent per agentId while the process is alive', async () => {
    await svc.startVisualAgent(baseOpts())
    await svc.startVisualAgent(baseOpts())
    expect(h.spawnCalls).toHaveLength(1)
  })

  it('send writes a user frame, emits an optimistic user event and goes running', async () => {
    await svc.startVisualAgent(baseOpts())
    lastChild()._emit('spawn')
    svc.sendVisualAgentMessage('agent-1', 'say hi')
    expect(lastChild().writes().at(-1)).toEqual({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'say hi' }] },
      parent_tool_use_id: null,
    })
    expect(events()).toEqual([expect.objectContaining({ kind: 'text', role: 'user', text: 'say hi' })])
    expect(frames('state').at(-1)).toMatchObject({ state: 'running', turnStartedAt: expect.any(String) })
  })

  it('streams partials, latches the session id from init (not commands_changed), and goes idle on result', async () => {
    await svc.startVisualAgent(baseOpts())
    const c = lastChild()
    c._line({ type: 'system', subtype: 'commands_changed', session_id: 'bogus', commands: [] })
    expect(svc.getVisualAgentState('agent-1')!.claudeSessionId).toBeNull()
    svc.sendVisualAgentMessage('agent-1', 'hi')
    c._line(init())
    expect(svc.getVisualAgentState('agent-1')!.claudeSessionId).toBe(SID)
    expect(frames('session')[0]).toEqual({ t: 'session', claudeSessionId: SID, model: 'claude-opus-5-5' })
    const delta = (text: string) => ({
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
      parent_tool_use_id: null,
      api_message_id: 'msg_1',
    })
    c._line(delta('Hi'))
    c._line(delta(' there'))
    expect(frames('partial').map((f: any) => f.text)).toEqual(['Hi', 'Hi there'])
    expect(svc.getVisualAgentState('agent-1')!.partial).toEqual({ messageId: 'msg_1', threadId: 'main', text: 'Hi there' })
    c._line({
      type: 'assistant',
      session_id: SID,
      parent_tool_use_id: null,
      message: { id: 'msg_1', role: 'assistant', content: [{ type: 'text', text: 'Hi there' }], usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 } },
    })
    expect(frames('partial').at(-1)).toMatchObject({ messageId: 'msg_1', text: '' })
    expect(frames('usage').at(-1)).toEqual({ t: 'usage', usage: { input: 1, output: 2, total: 10 } })
    c._line(result)
    const snap = svc.getVisualAgentState('agent-1')!
    expect(snap.state).toBe('idle')
    expect(snap.turnStartedAt).toBeNull()
    expect(snap.partial).toBeNull()
    expect(snap.events.map((e) => e.kind)).toEqual(['text', 'session', 'text', 'result'])
  })

  it('permission ask → needs-input; answer writes the control_response and resumes', async () => {
    await svc.startVisualAgent(baseOpts())
    const c = lastChild()
    svc.sendVisualAgentMessage('agent-1', 'push')
    c._line({
      type: 'control_request',
      request_id: 'req-9',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Bash',
        input: { command: 'git push' },
        tool_use_id: 'tu-1',
        permission_suggestions: [{ type: 'addRules', behavior: 'allow', destination: 'localSettings', rules: [{ toolName: 'Bash', ruleContent: 'git push:*' }] }],
      },
    })
    expect(svc.getVisualAgentState('agent-1')!.state).toBe('needs-input')
    expect(events().at(-1)).toMatchObject({ kind: 'ask', id: 'req-9', canAlwaysAllow: true })

    svc.answerVisualAgent('agent-1', 'req-9', 'always')
    const frame = c.writes().at(-1)
    expect(frame).toEqual({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: 'req-9',
        response: {
          behavior: 'allow',
          updatedInput: { command: 'git push' },
          updatedPermissions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'git push:*' }], behavior: 'allow', destination: 'session' }],
        },
      },
    })
    expect(events().at(-1)).toMatchObject({ kind: 'ask-result', id: 'req-9', decision: 'always' })
    expect(svc.getVisualAgentState('agent-1')!.state).toBe('running')
    expect(() => svc.answerVisualAgent('agent-1', 'req-9', 'allow')).toThrow(/no longer waiting/)
  })

  it('reports tab status for the workspace tab from the run state', async () => {
    await svc.startVisualAgent(baseOpts({ agentId: 'session-1:visual-agent:2' }))
    const c = lastChild()
    c._emit('spawn')
    expect(h.hooks).toEqual([])
    svc.sendVisualAgentMessage('session-1:visual-agent:2', 'push')
    c._line({
      type: 'control_request',
      request_id: 'req-1',
      request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'git push' }, tool_use_id: 'tu-1' },
    })
    svc.answerVisualAgent('session-1:visual-agent:2', 'req-1', 'allow')
    c._line(result)
    expect(h.hooks).toEqual([
      { contextId: 'session-1', tabId: 'visual-agent:2', hookType: 'prompt' },
      { contextId: 'session-1', tabId: 'visual-agent:2', hookType: 'notification' },
      { contextId: 'session-1', tabId: 'visual-agent:2', hookType: 'prompt' },
      { contextId: 'session-1', tabId: 'visual-agent:2', hookType: 'stop' },
    ])
  })

  it('maps run-state transitions to hook types', () => {
    const t = svc.hookTypeForTransition
    expect(t('idle', 'running')).toBe('prompt')
    expect(t('needs-input', 'running')).toBe('prompt')
    expect(t('running', 'needs-input')).toBe('notification')
    expect(t('running', 'idle')).toBe('stop')
    expect(t('needs-input', 'idle')).toBe('stop')
    expect(t('starting', 'idle')).toBeNull()
    expect(t('running', 'done')).toBeNull()
    expect(t('idle', 'idle')).toBeNull()
    expect(svc.workspaceTabId({ agentId: 's1:agent', sessionId: 's1' })).toBe('agent')
    expect(svc.workspaceTabId({ agentId: 's1:visual-agent:3', sessionId: 's1' })).toBe('visual-agent:3')
  })

  it('AskUserQuestion is answered through updatedInput.answers', async () => {
    await svc.startVisualAgent(baseOpts())
    const c = lastChild()
    const input = { questions: [{ question: 'Which DB?', options: [] }] }
    c._line({ type: 'control_request', request_id: 'q1', request: { subtype: 'can_use_tool', tool_name: 'AskUserQuestion', input } })
    svc.answerVisualAgent('agent-1', 'q1', 'allow', { 'Which DB?': 'Postgres' })
    expect(c.writes().at(-1).response.response).toEqual({ behavior: 'allow', updatedInput: { ...input, answers: { 'Which DB?': 'Postgres' } } })
  })

  it('interrupt sends a control_request and falls back to SIGINT on error', async () => {
    await svc.startVisualAgent(baseOpts())
    const c = lastChild()
    svc.interruptVisualAgent('agent-1')
    const req = c.writes().at(-1)
    expect(req).toMatchObject({ type: 'control_request', request: { subtype: 'interrupt' } })
    c._line({ type: 'control_response', response: { subtype: 'success', request_id: req.request_id } })
    expect(c.kill).not.toHaveBeenCalled()
    svc.interruptVisualAgent('agent-1')
    const req2 = c.writes().at(-1)
    c._line({ type: 'control_response', response: { subtype: 'error', request_id: req2.request_id, error: 'unsupported' } })
    expect(c.kill).toHaveBeenCalledWith('SIGINT')
  })

  it('setModel uses set_model and restarts with --resume when the CLI refuses', async () => {
    await svc.startVisualAgent(baseOpts())
    const c = lastChild()
    c._line(init())
    await svc.setVisualAgentModel('agent-1', 'claude-sonnet-5-5')
    const req = c.writes().at(-1)
    expect(req).toMatchObject({ type: 'control_request', request: { subtype: 'set_model', model: 'claude-sonnet-5-5' } })
    c._line({ type: 'control_response', response: { subtype: 'success', request_id: req.request_id } })
    expect(svc.getVisualAgentState('agent-1')!.model).toBe('claude-sonnet-5-5')
    expect(h.spawnCalls).toHaveLength(1)

    await svc.setVisualAgentModel('agent-1', 'claude-haiku-5-5')
    const req2 = c.writes().at(-1)
    c._line({ type: 'control_response', response: { subtype: 'error', request_id: req2.request_id, error: 'nope' } })
    await flush()
    expect(h.spawnCalls).toHaveLength(2)
    const args = h.spawnCalls[1].args
    expect(args[args.indexOf('--resume') + 1]).toBe(SID)
    expect(args[args.indexOf('--model') + 1]).toBe('claude-haiku-5-5')
    // The killed old process must not mark the agent failed.
    expect(svc.getVisualAgentState('agent-1')!.state).not.toBe('failed')
    await expect(svc.setVisualAgentModel('agent-1', 'gpt-4')).rejects.toThrow(/Invalid model/)
  })

  it('unexpected exit → failed with the first non-JSON output as an error event', async () => {
    await svc.startVisualAgent(baseOpts())
    const c = lastChild()
    c._stderr('Error: not logged in\nRun /login\n')
    c._exit(1)
    const snap = svc.getVisualAgentState('agent-1')!
    expect(snap.state).toBe('failed')
    expect(snap.events.at(-1)).toMatchObject({ kind: 'error', message: expect.stringContaining('not logged in') })
  })

  it('stop kills the process and ends in done; send afterwards respawns with --resume', async () => {
    await svc.startVisualAgent(baseOpts())
    lastChild()._line(init())
    svc.stopVisualAgent('agent-1')
    expect(svc.getVisualAgentState('agent-1')!.state).toBe('done')
    svc.sendVisualAgentMessage('agent-1', 'again')
    expect(h.spawnCalls).toHaveLength(2)
    expect(h.spawnCalls[1].args).toContain('--resume')
  })

  it('start after stop respawns on the same conversation; fresh starts a new one', async () => {
    await svc.startVisualAgent(baseOpts())
    lastChild()._line(init())
    lastChild()._line({ type: 'assistant', message: { id: 'm1', role: 'assistant', content: [{ type: 'text', text: 'hi' }] }, session_id: SID, parent_tool_use_id: null, uuid: 'u-1' })
    svc.stopVisualAgent('agent-1')
    const resumed = await svc.startVisualAgent(baseOpts())
    expect(h.spawnCalls).toHaveLength(2)
    expect(h.spawnCalls[1].args).toContain('--resume')
    expect(resumed.claudeSessionId).toBe(SID)

    svc.stopVisualAgent('agent-1')
    const fresh = await svc.startVisualAgent(baseOpts({ fresh: true, resumeClaudeSessionId: null }))
    expect(h.spawnCalls).toHaveLength(3)
    expect(h.spawnCalls[2].args).not.toContain('--resume')
    expect(fresh.claudeSessionId).toBeNull()
    expect(fresh.events).toEqual([])
  })

  it('fork spawns a no-tools resume+fork process, streams fork-events and ends on result', async () => {
    await svc.startVisualAgent(baseOpts())
    expect(() => svc.forkVisualAgent('agent-1', 'why?')).toThrow(/send a message first/)
    lastChild()._line(init())
    expect(() => svc.forkVisualAgent('agent-1', '   ')).toThrow(/needs a question/)
    const { forkId } = svc.forkVisualAgent('agent-1', 'why?')
    const fork = lastChild()
    const args = h.spawnCalls[1].args
    expect(args[args.indexOf('--resume') + 1]).toBe(SID)
    expect(args).toContain('--fork-session')
    expect(args[args.indexOf('--session-id') + 1]).toBe(forkId)
    expect(args[args.indexOf('--tools') + 1]).toBe('')
    expect(args).toContain('--strict-mcp-config')
    expect(args.join(' ')).not.toMatch(/--permission-mode|--dangerously-skip-permissions|--permission-prompt-tool/)
    const sent = fork.writes()[0]
    expect(sent.message.content[0].text).toMatch(/side question[\s\S]*why\?$/)
    expect(frames('forks').at(-1).forks[0]).toMatchObject({ id: forkId, question: 'why?', state: 'running' })

    fork._line({ type: 'assistant', session_id: forkId, parent_tool_use_id: null, message: { id: 'm', role: 'assistant', content: [{ type: 'text', text: 'because' }] } })
    fork._line({ ...result, session_id: forkId })
    expect(frames('fork-event').map((f: any) => f.event.kind)).toEqual(['text', 'result'])
    const snap = svc.getVisualAgentState('agent-1')!
    expect(snap.forks[0]).toMatchObject({ state: 'done', events: [expect.objectContaining({ text: 'because' }), expect.anything()] })
    // The main conversation is untouched by the fork.
    expect(snap.events.every((e) => e.kind !== 'text' || e.text !== 'because')).toBe(true)
  })

  it('carries an aside on: a follow-up resumes the fork session itself, with no tools', async () => {
    await svc.startVisualAgent(baseOpts())
    lastChild()._line(init())
    const { forkId } = svc.forkVisualAgent('agent-1', 'why?')
    const first = lastChild()
    expect(() => svc.sendVisualAgentFork('agent-1', forkId, 'more?')).toThrow(/still answering/)
    first._line({ ...result, session_id: forkId })
    expect(svc.getVisualAgentState('agent-1')!.forks[0].state).toBe('done')

    svc.sendVisualAgentFork('agent-1', forkId, 'and then?')
    const second = lastChild()
    expect(second).not.toBe(first)
    const args = h.spawnCalls.at(-1).args
    expect(args[args.indexOf('--resume') + 1]).toBe(forkId)
    expect(args).not.toContain('--fork-session')
    expect(args).not.toContain('--session-id')
    expect(args[args.indexOf('--tools') + 1]).toBe('')
    expect(args).toContain('--strict-mcp-config')
    expect(args.join(' ')).not.toMatch(/--permission-mode|--dangerously-skip-permissions|--permission-prompt-tool/)
    expect(second.writes()[0].message.content[0].text).toBe('and then?')
    expect(svc.getVisualAgentState('agent-1')!.forks[0].state).toBe('running')

    // The first run's late exit must not touch the second run.
    first._exit(1)
    expect(svc.getVisualAgentState('agent-1')!.forks[0].state).toBe('running')

    second._line({ type: 'assistant', session_id: forkId, parent_tool_use_id: null, message: { id: 'm2', role: 'assistant', content: [{ type: 'text', text: 'then this' }] } })
    second._line({ ...result, session_id: forkId })
    const fork = svc.getVisualAgentState('agent-1')!.forks[0]
    expect(fork.state).toBe('done')
    const said = fork.events.filter((e) => e.kind === 'text').map((e: any) => [e.role, e.text])
    expect(said).toEqual([['user', 'and then?'], ['assistant', 'then this']])
    const seqs = fork.events.map((e) => e.seq)
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs)
    // The main conversation is untouched.
    expect(svc.getVisualAgentState('agent-1')!.events.some((e) => e.kind === 'text' && e.text === 'and then?')).toBe(false)
  })

  it('caps live forks at 3', async () => {
    await svc.startVisualAgent(baseOpts())
    lastChild()._line(init())
    svc.forkVisualAgent('agent-1', 'a')
    svc.forkVisualAgent('agent-1', 'b')
    svc.forkVisualAgent('agent-1', 'c')
    expect(() => svc.forkVisualAgent('agent-1', 'd')).toThrow(/At most 3/)
  })

  it('persists both directions and replays them (flagged replayed) on resume', async () => {
    await svc.startVisualAgent(baseOpts())
    const c = lastChild()
    svc.sendVisualAgentMessage('agent-1', 'remember me')
    c._line(init())
    c._line({ type: 'assistant', session_id: SID, parent_tool_use_id: null, message: { id: 'm', role: 'assistant', content: [{ type: 'text', text: 'noted' }] } })
    c._line(result)
    await flush()
    const file = join(h.userData, 'visual-agents', `${SID}.jsonl`)
    const lines = readFileSync(file, 'utf-8').trim().split('\n').map((l) => JSON.parse(l))
    expect(lines[0]).toMatchObject({ dir: 'out' })
    expect(lines.some((l) => l.dir === 'in')).toBe(true)

    svc.__resetVisualAgentsForTest()
    const snap = await svc.startVisualAgent(baseOpts({ agentId: 'agent-2', resumeClaudeSessionId: SID }))
    expect(snap.claudeSessionId).toBe(SID)
    expect(snap.events.map((e) => [e.kind, (e as any).text])).toEqual([
      ['text', 'remember me'],
      ['session', undefined],
      ['text', 'noted'],
      ['result', ''],
    ])
    expect(snap.events.every((e) => e.replayed)).toBe(true)
    const args = h.spawnCalls.at(-1).args
    expect(args[args.indexOf('--resume') + 1]).toBe(SID)
  })

  it("rebuilds a conversation it never ran (e.g. teleported) from Claude's own transcript, and keeps it", async () => {
    const config = mkdtempSync(join(root, 'cfg-'))
    const dir = join(config, 'projects', '-wt')
    mkdirSync(dir, { recursive: true })
    const rows = [
      { type: 'user', uuid: 'u1', sessionId: SID, isSidechain: false, timestamp: '2026-10-21T09:00:00.000Z', remoteSourced: true, message: { role: 'user', content: 'build the thing' } },
      { type: 'assistant', uuid: 'a1', sessionId: SID, isSidechain: false, timestamp: '2026-10-21T09:00:05.000Z', remoteSourced: true, message: { id: 'msg1', role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }] } },
      { type: 'user', uuid: 'u2', isSidechain: false, timestamp: '2026-10-21T09:00:06.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'a.ts' }] } },
      { type: 'assistant', uuid: 'side', isSidechain: true, timestamp: '2026-10-21T09:00:07.000Z', message: { id: 'x', role: 'assistant', content: [{ type: 'text', text: 'subagent chatter' }] } },
      { type: 'assistant', uuid: 'a2', isSidechain: false, timestamp: '2026-10-21T09:00:08.000Z', message: { id: 'msg2', role: 'assistant', content: [{ type: 'text', text: 'built it' }] } },
      { type: 'user', uuid: 'u3', isMeta: true, timestamp: '2026-10-21T09:10:00.000Z', message: { role: 'user', content: 'This session is being continued from another machine.' } },
      { type: 'last-prompt', sessionId: SID },
    ]
    writeFileSync(join(dir, `${SID}.jsonl`), rows.map((r) => JSON.stringify(r)).join('\n') + '\n{torn')

    const snap = await svc.startVisualAgent(baseOpts({ resumeClaudeSessionId: SID, claudeConfigDir: config }))
    expect(snap.events.map((e) => [e.kind, (e as any).text ?? (e as any).name ?? ''])).toEqual([
      ['text', 'build the thing'],
      ['tool', 'Bash'],
      ['tool-result', 'a.ts'],
      ['text', 'built it'],
      ['note', 'This session is being continued from another machine.'],
    ])
    expect(snap.events.every((e) => e.replayed)).toBe(true)
    expect(snap.events[0].at).toBe('2026-10-21T09:00:00.000Z')
    const args = h.spawnCalls.at(-1).args
    expect(args[args.indexOf('--resume') + 1]).toBe(SID)

    // Our own store is seeded, so a later resume still has the whole history.
    await flush()
    const ours = readFileSync(join(h.userData, 'visual-agents', `${SID}.jsonl`), 'utf-8').trim().split('\n').map((l) => JSON.parse(l))
    expect(ours.map((l) => l.dir)).toEqual(['out', 'in', 'in', 'in', 'out'])
    svc.__resetVisualAgentsForTest()
    const again = await svc.startVisualAgent(baseOpts({ agentId: 'agent-2', resumeClaudeSessionId: SID, claudeConfigDir: join(root, 'nowhere') }))
    expect(again.events.filter((e) => e.kind === 'text').map((e) => (e as any).text)).toEqual(['build the thing', 'built it'])
  })

  it('a corrupt transcript never stops the session from starting', async () => {
    mkdirSync(join(h.userData, 'visual-agents'), { recursive: true })
    writeFileSync(join(h.userData, 'visual-agents', `${SID}.jsonl`), 'not json\n{"dir":"in","line":"{"}\n')
    const snap = await svc.startVisualAgent(baseOpts({ resumeClaudeSessionId: SID }))
    expect(snap.events).toEqual([])
    expect(h.spawnCalls).toHaveLength(1)
  })

  it('killAllVisualAgents kills main processes and forks', async () => {
    const { killChildTree } = await import('../../../src/main/services/claude-headless.service')
    vi.mocked(killChildTree).mockClear()
    await svc.startVisualAgent(baseOpts())
    lastChild()._line(init())
    svc.forkVisualAgent('agent-1', 'q')
    svc.killAllVisualAgents()
    expect(vi.mocked(killChildTree)).toHaveBeenCalledTimes(2)
  })
})
