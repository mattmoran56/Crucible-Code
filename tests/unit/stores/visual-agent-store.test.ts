import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VisualAgentEvent, VisualAgentFrame, VisualAgentSnapshot } from '../../../src/shared/visual-agent'
import {
  __resetVisualAgentSubscription,
  emptySnapshot,
  isAskPending,
  localMessage,
  mergeSnapshot,
  reduceFrame,
  useVisualAgentStore,
  withEvent,
} from '../../../src/renderer/stores/visualAgentStore'

const text = (uuid: string, role: 'user' | 'assistant', body: string, threadId = 'main'): VisualAgentEvent => ({
  uuid,
  seq: 0,
  threadId,
  at: '2026-10-21T09:00:00.000Z',
  kind: 'text',
  role,
  text: body,
})

const snap = (over: Partial<VisualAgentSnapshot> = {}): VisualAgentSnapshot => ({ ...emptySnapshot('a1'), ...over })

describe('withEvent', () => {
  it('dedupes by uuid', () => {
    const e = text('x', 'assistant', 'hi')
    const once = withEvent([], e)
    expect(withEvent(once, { ...e })).toBe(once)
  })

  it('replaces the optimistic user bubble with its echo', () => {
    const local = localMessage('fix it', 1)
    const next = withEvent([local], text('real', 'user', 'fix it'))
    expect(next).toHaveLength(1)
    expect(next[0].uuid).toBe('real')
  })

  it('does not fold an echo into a different message', () => {
    const next = withEvent([localMessage('one', 1)], text('real', 'user', 'two'))
    expect(next).toHaveLength(2)
  })
})

describe('reduceFrame', () => {
  it('stores and clears the streaming partial when the final text arrives on that thread', () => {
    let s = reduceFrame(snap(), { t: 'partial', messageId: 'm', threadId: 'main', text: 'Hel' })
    expect(s.partial?.text).toBe('Hel')
    s = reduceFrame(s, { t: 'partial', messageId: 'm', threadId: 'main', text: 'Hello' })
    expect(s.partial?.text).toBe('Hello')
    const other = reduceFrame(s, { t: 'event', event: text('t1', 'assistant', 'sub', 'task') })
    expect(other.partial).not.toBeNull()
    const done = reduceFrame(s, { t: 'event', event: text('t2', 'assistant', 'Hello') })
    expect(done.partial).toBeNull()
    expect(done.events).toHaveLength(1)
  })

  it('clears the partial on an empty accumulation and when the turn ends', () => {
    const s = reduceFrame(snap(), { t: 'partial', messageId: 'm', threadId: 'main', text: 'x' })
    expect(reduceFrame(s, { t: 'partial', messageId: 'm', threadId: 'main', text: '' }).partial).toBeNull()
    expect(reduceFrame(s, { t: 'state', state: 'idle', turnStartedAt: null }).partial).toBeNull()
    expect(reduceFrame(s, { t: 'state', state: 'running', turnStartedAt: 'now' }).partial).not.toBeNull()
  })

  it('returns the same snapshot for a duplicate event', () => {
    const s = reduceFrame(snap(), { t: 'event', event: text('x', 'assistant', 'a') })
    expect(reduceFrame(s, { t: 'event', event: text('x', 'assistant', 'a') })).toBe(s)
  })

  it('applies session, usage and state frames', () => {
    let s = reduceFrame(snap(), { t: 'session', claudeSessionId: 'sid', model: 'claude-haiku-5-5' })
    s = reduceFrame(s, { t: 'usage', usage: { input: 1, output: 2, total: 3 } })
    s = reduceFrame(s, { t: 'state', state: 'running', turnStartedAt: 'T' })
    expect(s).toMatchObject({ claudeSessionId: 'sid', model: 'claude-haiku-5-5', state: 'running', turnStartedAt: 'T' })
    expect(s.usage?.total).toBe(3)
    // A model change before any conversation must not wipe the known id.
    expect(reduceFrame(s, { t: 'session', claudeSessionId: '', model: 'claude-opus-5-5' }).claudeSessionId).toBe('sid')
  })

  it('replaces forks wholesale but keeps fork events already received', () => {
    const fork = { id: 'f', question: 'q', startedAt: 'T', afterSeq: 0, state: 'running' as const, events: [] }
    let s = reduceFrame(snap(), { t: 'forks', forks: [fork] })
    s = reduceFrame(s, { t: 'fork-event', forkId: 'f', event: text('fe', 'assistant', 'answer') })
    expect(s.forks[0].events).toHaveLength(1)
    s = reduceFrame(s, { t: 'forks', forks: [{ ...fork, state: 'done' }] })
    expect(s.forks[0].state).toBe('done')
    expect(s.forks[0].events.map((e) => e.uuid)).toEqual(['fe'])
    expect(reduceFrame(s, { t: 'forks', forks: [] }).forks).toEqual([])
  })

  it('ignores events for an unknown fork', () => {
    const s = snap()
    expect(reduceFrame(s, { t: 'fork-event', forkId: 'nope', event: text('x', 'assistant', 'a') })).toBe(s)
  })
})

describe('mergeSnapshot / isAskPending', () => {
  it('unions events that arrived by frame before start resolved', () => {
    const held = snap({ events: [text('late', 'assistant', 'b')] })
    const merged = mergeSnapshot(held, snap({ events: [text('early', 'assistant', 'a')], state: 'idle' }))
    expect(merged.events.map((e) => e.uuid)).toEqual(['early', 'late'])
    expect(merged.state).toBe('idle')
  })

  it('keeps a later state over a start reply that still says starting', () => {
    // The process reported idle by frame before `start` resolved.
    const held = snap({ state: 'idle' })
    expect(mergeSnapshot(held, snap({ state: 'starting' })).state).toBe('idle')
    // Any other incoming state still wins.
    expect(mergeSnapshot(snap({ state: 'idle' }), snap({ state: 'running' })).state).toBe('running')
    expect(mergeSnapshot(snap({ state: 'starting' }), snap({ state: 'starting' })).state).toBe('starting')
  })

  it('treats an undecided ask on a waiting run as pending', () => {
    const ask: VisualAgentEvent = {
      uuid: 'a', seq: 0, threadId: 'main', at: 'T', kind: 'ask', id: 'q', tool: 'Bash', input: {}, toolUseId: 't',
      description: '', reason: '', canAlwaysAllow: false,
    }
    expect(isAskPending(snap({ state: 'needs-input', events: [ask] }), 'q')).toBe(true)
    expect(isAskPending(snap({ state: 'idle', events: [ask] }), 'q')).toBe(false)
    const decided: VisualAgentEvent = { uuid: 'b', seq: 1, threadId: 'main', at: 'T', kind: 'ask-result', id: 'q', decision: 'deny' }
    expect(isAskPending(snap({ state: 'needs-input', events: [ask, decided] }), 'q')).toBe(false)
    expect(isAskPending(snap({ state: 'needs-input', events: [{ ...ask, replayed: true } as VisualAgentEvent] }), 'q')).toBe(false)
  })
})

describe('store wiring', () => {
  let emit: (agentId: string, frame: VisualAgentFrame) => void
  let api: Record<string, ReturnType<typeof vi.fn>>

  beforeEach(() => {
    __resetVisualAgentSubscription()
    useVisualAgentStore.setState({ agents: {}, errors: {}, ui: {}, options: {} })
    api = {
      start: vi.fn(async () => snap({ agentId: 'a1', state: 'idle', claudeSessionId: 'sid' })),
      getState: vi.fn(async () => null),
      send: vi.fn(async () => {}),
      interrupt: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      answer: vi.fn(async () => {}),
      setModel: vi.fn(async () => {}),
      fork: vi.fn(async () => ({ forkId: 'f1' })),
      forkStop: vi.fn(async () => {}),
      onFrame: vi.fn((cb) => {
        emit = cb
        return () => {}
      }),
    }
    ;(window as any).api = { visualAgent: api }
  })

  it('starts once, subscribes once and reduces frames into the agent', async () => {
    const opts = { agentId: 'a1', sessionId: 's', cwd: '/w' }
    await Promise.all([useVisualAgentStore.getState().ensureStarted(opts), useVisualAgentStore.getState().ensureStarted(opts)])
    expect(api.start).toHaveBeenCalledTimes(1)
    expect(api.onFrame).toHaveBeenCalledTimes(1)
    emit('a1', { t: 'event', event: text('e1', 'assistant', 'hello') })
    expect(useVisualAgentStore.getState().agents.a1.events).toHaveLength(1)
    emit('a1', { t: 'error', message: 'boom' })
    expect(useVisualAgentStore.getState().errors.a1).toBe('boom')
  })

  it('send draws the message optimistically and calls the bridge', async () => {
    await useVisualAgentStore.getState().ensureStarted({ agentId: 'a1', sessionId: 's', cwd: '/w' })
    await useVisualAgentStore.getState().send('a1', 'do it')
    expect(api.send).toHaveBeenCalledWith('a1', 'do it')
    const events = useVisualAgentStore.getState().agents.a1.events
    expect(events[events.length - 1]).toMatchObject({ kind: 'text', role: 'user', text: 'do it' })
  })

  it('answer tracks the in-flight ask until its result arrives', async () => {
    await useVisualAgentStore.getState().ensureStarted({ agentId: 'a1', sessionId: 's', cwd: '/w' })
    await useVisualAgentStore.getState().answer('a1', 'q', 'allow', { Q: 'A' })
    expect(api.answer).toHaveBeenCalledWith('a1', 'q', 'allow', { Q: 'A' })
    expect(useVisualAgentStore.getState().ui.a1.answering).toBe('q')
    emit('a1', { t: 'event', event: { uuid: 'r', seq: 1, threadId: 'main', at: 'T', kind: 'ask-result', id: 'q', decision: 'allow' } })
    expect(useVisualAgentStore.getState().ui.a1.answering).toBeNull()
  })

  it('fork opens the fork sheet for the returned id', async () => {
    await useVisualAgentStore.getState().fork('a1', '  why?  ')
    expect(api.fork).toHaveBeenCalledWith('a1', 'why?')
    expect(useVisualAgentStore.getState().ui.a1.openForkId).toBe('f1')
  })

  it('restart goes straight to start (respawning an ended agent), resuming unless fresh', async () => {
    const opts = { agentId: 'a1', sessionId: 's', cwd: '/w', initialPrompt: 'hello' }
    await useVisualAgentStore.getState().ensureStarted(opts)
    api.getState.mockResolvedValue(snap({ agentId: 'a1', state: 'done', claudeSessionId: 'sid' }))
    await useVisualAgentStore.getState().restart('a1')
    expect(api.stop).toHaveBeenCalledWith('a1')
    expect(api.start).toHaveBeenLastCalledWith(
      expect.objectContaining({ agentId: 'a1', resumeClaudeSessionId: 'sid', initialPrompt: null, fresh: false }),
    )
    await useVisualAgentStore.getState().restart('a1', true)
    expect(api.start).toHaveBeenLastCalledWith(expect.objectContaining({ resumeClaudeSessionId: null, fresh: true }))
    expect(api.getState).toHaveBeenCalledTimes(1)
  })

  it('release stops the agent and a later ensureStarted respawns it rather than re-reading the ended snapshot', async () => {
    const opts = { agentId: 'a1', sessionId: 's', cwd: '/w' }
    await useVisualAgentStore.getState().ensureStarted(opts)
    await useVisualAgentStore.getState().release('a1')
    expect(api.stop).toHaveBeenCalledWith('a1')
    api.getState.mockResolvedValue(snap({ agentId: 'a1', state: 'done', claudeSessionId: 'sid' }))
    await useVisualAgentStore.getState().ensureStarted(opts)
    expect(api.start).toHaveBeenCalledTimes(2)
  })

  it('without a release, an existing agent is adopted from getState, not restarted', async () => {
    api.getState.mockResolvedValue(snap({ agentId: 'a1', state: 'done', claudeSessionId: 'sid' }))
    await useVisualAgentStore.getState().ensureStarted({ agentId: 'a1', sessionId: 's', cwd: '/w' })
    expect(api.start).not.toHaveBeenCalled()
    expect(useVisualAgentStore.getState().agents.a1.state).toBe('done')
  })

  it('releaseSession stops only that session\u2019s agents', async () => {
    await useVisualAgentStore.getState().ensureStarted({ agentId: 's1:agent', sessionId: 's1', cwd: '/w' })
    await useVisualAgentStore.getState().ensureStarted({ agentId: 's1:visual-agent:2', sessionId: 's1', cwd: '/w' })
    await useVisualAgentStore.getState().ensureStarted({ agentId: 's2:agent', sessionId: 's2', cwd: '/w' })
    await useVisualAgentStore.getState().releaseSession('s1')
    expect(api.stop.mock.calls.map((c) => c[0]).sort()).toEqual(['s1:agent', 's1:visual-agent:2'])
  })

  it('startWithPrompt starts an idle agent with the prompt as its first message', async () => {
    await useVisualAgentStore.getState().startWithPrompt({ agentId: 'a1', sessionId: 's', cwd: '/w', initialPrompt: 'go' })
    expect(api.start).toHaveBeenCalledTimes(1)
    expect(api.start.mock.calls[0][0]).toMatchObject({ initialPrompt: 'go' })
    expect(api.send).not.toHaveBeenCalled()
  })

  it('startWithPrompt sends the prompt once an agent another caller is already starting is ready', async () => {
    let resolveStart!: (s: VisualAgentSnapshot) => void
    api.start.mockImplementationOnce(() => new Promise<VisualAgentSnapshot>((r) => (resolveStart = r)))
    // The tab's panel starts the agent first, with no prompt…
    const panel = useVisualAgentStore.getState().ensureStarted({ agentId: 'a1', sessionId: 's', cwd: '/w' })
    await Promise.resolve()
    // …then a background flow (Notion pickup) asks for its prompt.
    const flow = useVisualAgentStore.getState().startWithPrompt({ agentId: 'a1', sessionId: 's', cwd: '/w', initialPrompt: 'go' })
    await Promise.resolve()
    expect(api.send).not.toHaveBeenCalled()
    resolveStart(snap({ agentId: 'a1', state: 'idle', claudeSessionId: 'sid' }))
    await Promise.all([panel, flow])
    expect(api.start).toHaveBeenCalledTimes(1)
    expect(api.send).toHaveBeenCalledWith('a1', 'go')
  })

  it('startWithPrompt sends to a running agent rather than starting another', async () => {
    useVisualAgentStore.getState().seed(snap({ agentId: 'a1', state: 'idle', claudeSessionId: 'sid' }))
    await useVisualAgentStore.getState().startWithPrompt({ agentId: 'a1', sessionId: 's', cwd: '/w', initialPrompt: 'next' })
    expect(api.start).not.toHaveBeenCalled()
    expect(api.send).toHaveBeenCalledWith('a1', 'next')
  })

  it('does not get stuck starting when the idle frame overtakes the start reply', async () => {
    api.start.mockImplementationOnce(async () => {
      emit('a1', { t: 'state', state: 'idle', turnStartedAt: null })
      return snap({ agentId: 'a1', state: 'starting' })
    })
    await useVisualAgentStore.getState().ensureStarted({ agentId: 'a1', sessionId: 's', cwd: '/w' })
    expect(useVisualAgentStore.getState().agents.a1.state).toBe('idle')
  })

  it('records an error when start fails', async () => {
    api.start.mockRejectedValueOnce(new Error('no claude'))
    await useVisualAgentStore.getState().ensureStarted({ agentId: 'a1', sessionId: 's', cwd: '/w' })
    expect(useVisualAgentStore.getState().errors.a1).toBe('no claude')
    expect(useVisualAgentStore.getState().agents.a1.state).toBe('failed')
  })
})
