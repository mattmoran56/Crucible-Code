/**
 * Integration tests for the scheduler fire handlers.
 *
 * These exercise the full renderer-side fire path: store wiring, IPC writes,
 * pendingStartup handoff, and cross-project fire safety. They cover the bug
 * the user hit (queued session "fires" on disk but never appears in the UI)
 * and its sibling (cross-project firing would corrupt the target project's
 * session list).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireQueuedSession, fireQueuedMessage } from '../../../src/renderer/hooks/useSchedulerBootstrap'
import { useProjectStore } from '../../../src/renderer/stores/projectStore'
import { useSessionStore } from '../../../src/renderer/stores/sessionStore'
import { useToastStore } from '../../../src/renderer/stores/toastStore'
import { useVisualAgentStore, __resetVisualAgentSubscription } from '../../../src/renderer/stores/visualAgentStore'
import type { QueuedSession, QueuedMessage, Session } from '../../../src/shared/types'

const project = (overrides: Partial<{ id: string; name: string; repoPath: string }> = {}) => ({
  id: 'proj-A',
  name: 'A',
  repoPath: '/repo/A',
  ...overrides,
})

const session = (overrides: Partial<Session> = {}): Session => ({
  id: 'sess-1',
  name: 'feat/x',
  branchName: 'session/feat-x',
  worktreePath: '/repo/A/.worktrees/feat-x',
  projectId: 'proj-A',
  createdAt: '2026-05-05T10:00:00Z',
  ...overrides,
})

const queuedSession = (overrides: Partial<QueuedSession> = {}): QueuedSession => ({
  id: 'qs-1',
  projectId: 'proj-A',
  name: 'feat/y',
  startupPrompt: 'do the thing',
  scheduledFor: Date.now() + 60_000,
  createdAt: '2026-05-05T10:00:00Z',
  ...overrides,
})

const queuedMessage = (overrides: Partial<QueuedMessage> = {}): QueuedMessage => ({
  id: 'qm-1',
  sessionId: 'sess-1',
  message: 'continue',
  scheduledFor: Date.now() + 60_000,
  createdAt: '2026-05-05T10:00:00Z',
  reason: 'usage-reset',
  ...overrides,
})

// In-memory persistence layer for window.api.session.{list,save}, and a
// minimal stub for window.api.worktree.create + window.api.terminal.write.
const persisted: Record<string, Session[]> = {}
const writeCalls: Array<{ terminalId: string; data: string }> = []

const sessionApi = {
  list: vi.fn(async (projectId: string) => persisted[projectId] ? [...persisted[projectId]] : []),
  save: vi.fn(async (projectId: string, sessions: Session[]) => {
    persisted[projectId] = [...sessions]
  }),
  saveContext: vi.fn(async () => {}),
  getContext: vi.fn(async () => null),
}

const worktreeApi = {
  create: vi.fn(async (_repo: string, name: string) => ({
    path: `/created/${name}`,
    branch: `session/${name}`,
  })),
  remove: vi.fn(async () => {}),
}

const gitApi = {
  isMerged: vi.fn(async () => false),
}

const dataListeners = new Set<(terminalId: string, data: string) => void>()

const terminalApi = {
  write: vi.fn(async (terminalId: string, data: string) => {
    writeCalls.push({ terminalId, data })
  }),
  killSession: vi.fn(async () => {}),
  onData: vi.fn((cb: (terminalId: string, data: string) => void) => {
    dataListeners.add(cb)
    return () => { dataListeners.delete(cb) }
  }),
}

// The fire handlers start (or message) the session's Agent tab visual agent.
const visualAgentApi = {
  start: vi.fn(async (opts: { agentId: string; model: string }) => ({
    agentId: opts.agentId,
    claudeSessionId: `cs-${opts.agentId}`,
    model: opts.model,
    state: 'idle',
    events: [],
    partial: null,
    usage: null,
    forks: [],
    turnStartedAt: null,
  })),
  getState: vi.fn(async () => null),
  send: vi.fn(async () => {}),
  stop: vi.fn(async () => {}),
  onFrame: vi.fn(() => () => {}),
}

const schedulerApi = {
  listQueuedSessions: vi.fn(async () => []),
  addQueuedSession: vi.fn(async () => []),
  cancelQueuedSession: vi.fn(async () => []),
  rescheduleQueuedSession: vi.fn(async () => []),
  fireQueuedSessionNow: vi.fn(async () => {}),
  onQueuedSessionsUpdate: vi.fn(() => () => {}),
  onFireQueuedSession: vi.fn(() => () => {}),
  listQueuedMessages: vi.fn(async () => []),
  addQueuedMessage: vi.fn(async () => []),
  cancelQueuedMessage: vi.fn(async () => []),
  onQueuedMessagesUpdate: vi.fn(() => () => {}),
  onFireQueuedMessage: vi.fn(() => () => {}),
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false })
  for (const k of Object.keys(persisted)) delete persisted[k]
  writeCalls.length = 0
  dataListeners.clear()

  sessionApi.list.mockClear()
  sessionApi.save.mockClear()
  worktreeApi.create.mockClear()
  terminalApi.write.mockClear()
  terminalApi.onData.mockClear()
  visualAgentApi.start.mockClear()
  visualAgentApi.send.mockClear()
  __resetVisualAgentSubscription()
  useVisualAgentStore.setState({ agents: {}, errors: {}, ui: {}, options: {} })

  ;(window as any).api = {
    session: sessionApi,
    worktree: worktreeApi,
    git: gitApi,
    terminal: terminalApi,
    scheduler: schedulerApi,
    visualAgent: visualAgentApi,
  }

  // Reset stores
  useProjectStore.setState({
    projects: [],
    activeProjectId: null,
    claudeAccounts: [],
  } as any)
  useSessionStore.setState({
    sessions: [],
    currentProjectId: null,
    activeSessionId: null,
    activePRNumber: null,
    activeWorkspaceTab: 'agent',
    didStash: false,
    detachedWorktree: null,
    openedAsMainBranch: null,
    previousMainBranch: null,
    pendingStartup: null,
    pendingFocusSessionId: null,
  } as any)
  useToastStore.setState({ toasts: [] })
})

const startCall = (i = 0) => visualAgentApi.start.mock.calls[i][0] as unknown as Record<string, unknown>

describe('fireQueuedSession', () => {
  it('creates the worktree, persists the session, and starts its visual agent with the prompt', async () => {
    useProjectStore.setState({ projects: [project()], activeProjectId: 'proj-A' } as any)
    useSessionStore.setState({ currentProjectId: 'proj-A', sessions: [] } as any)
    persisted['proj-A'] = []

    const item = queuedSession({ name: 'feat/y', startupPrompt: 'go' })
    await fireQueuedSession(item)

    // Worktree was created
    expect(worktreeApi.create).toHaveBeenCalledWith('/repo/A', 'feat/y', undefined)

    // Session was persisted to disk
    expect(persisted['proj-A']).toHaveLength(1)
    expect(persisted['proj-A'][0].name).toBe('feat/y')

    // Sidebar visibility for the active project
    const state = useSessionStore.getState()
    expect(state.sessions).toHaveLength(1)
    expect(state.sessions[0].name).toBe('feat/y')

    // We do NOT activate the new session — user keeps their current view.
    expect(state.activeSessionId).toBeNull()

    // The Agent tab's visual agent starts in the background with the prompt
    // as its first message.
    expect(visualAgentApi.start).toHaveBeenCalledTimes(1)
    expect(startCall()).toMatchObject({
      agentId: `${state.sessions[0].id}:agent`,
      sessionId: state.sessions[0].id,
      cwd: state.sessions[0].worktreePath,
      initialPrompt: 'go',
    })

    // The agent is held in the store, so opening the session later attaches
    // to it rather than starting another.
    expect(useVisualAgentStore.getState().agents[`${state.sessions[0].id}:agent`]).toBeDefined()
  })

  it('starts no agent when the queued session has no prompt', async () => {
    useProjectStore.setState({ projects: [project()], activeProjectId: 'proj-A' } as any)
    useSessionStore.setState({ currentProjectId: 'proj-A', sessions: [] } as any)
    persisted['proj-A'] = []
    await fireQueuedSession(queuedSession({ startupPrompt: '' }))
    expect(visualAgentApi.start).not.toHaveBeenCalled()
  })

  it('does not corrupt other projects when firing for a non-active project', async () => {
    // User is on Project A, with one existing session on each project.
    const a = project({ id: 'proj-A', repoPath: '/repo/A' })
    const b = project({ id: 'proj-B', repoPath: '/repo/B' })
    const aSess = session({ id: 'a1', projectId: 'proj-A', name: 'a-existing' })
    const bSess = session({ id: 'b1', projectId: 'proj-B', name: 'b-existing' })
    persisted['proj-A'] = [aSess]
    persisted['proj-B'] = [bSess]

    useProjectStore.setState({ projects: [a, b], activeProjectId: 'proj-A' } as any)
    useSessionStore.setState({
      sessions: [aSess],
      currentProjectId: 'proj-A',
    } as any)

    // Fire a queued session targeting Project B
    await fireQueuedSession(queuedSession({ projectId: 'proj-B', name: 'b-new' }))

    // Project B's existing session must still be there
    const bSaved = persisted['proj-B']
    expect(bSaved.map((s) => s.name).sort()).toEqual(['b-existing', 'b-new'])

    // Project A's existing session must NOT have been written to B's storage
    expect(bSaved.map((s) => s.name)).not.toContain('a-existing')

    // Project A's storage must be untouched
    expect(persisted['proj-A']).toEqual([aSess])

    // The user is NOT yanked over to project B — their view stays on A.
    expect(useProjectStore.getState().activeProjectId).toBe('proj-A')
    const fired = useSessionStore.getState()
    expect(fired.currentProjectId).toBe('proj-A')
    // The new session did start its agent though.
    expect(visualAgentApi.start).toHaveBeenCalledTimes(1)
    expect(startCall().cwd).toBe('/created/b-new') // cwd = worktreePath
    expect(startCall().repoPath).toBe('/repo/B')
  })

  it('shows a toast when the project no longer exists', async () => {
    useProjectStore.setState({ projects: [], activeProjectId: null } as any)

    await fireQueuedSession(queuedSession({ projectId: 'gone' }))

    const toasts = useToastStore.getState().toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0].type).toBe('error')
    expect(toasts[0].message).toMatch(/no longer registered/)
    expect(worktreeApi.create).not.toHaveBeenCalled()
  })
})

describe('fireQueuedMessage', () => {
  it('starts the visual agent (resuming its saved conversation) with the message when none is running', async () => {
    const sess = session({
      id: 'sess-1',
      projectId: 'proj-A',
      visualAgents: { agent: { claudeSessionId: 'cs-old', model: 'claude-opus-5-5' } },
    })
    persisted['proj-A'] = [sess]
    useProjectStore.setState({ projects: [project()], activeProjectId: 'proj-A' } as any)
    useSessionStore.setState({ sessions: [sess], currentProjectId: 'proj-A' } as any)

    await fireQueuedMessage(queuedMessage({ sessionId: 'sess-1', message: 'continue' }))

    expect(visualAgentApi.start).toHaveBeenCalledTimes(1)
    expect(startCall()).toMatchObject({ agentId: 'sess-1:agent', resumeClaudeSessionId: 'cs-old', initialPrompt: 'continue' })
    expect(visualAgentApi.send).not.toHaveBeenCalled()
  })

  it('sends the message to the running visual agent when there is one', async () => {
    const sess = session({ id: 'sess-1', projectId: 'proj-A' })
    persisted['proj-A'] = [sess]
    useProjectStore.setState({ projects: [project()], activeProjectId: 'proj-A' } as any)
    useSessionStore.setState({ sessions: [sess], currentProjectId: 'proj-A' } as any)
    useVisualAgentStore.getState().seed({
      agentId: 'sess-1:agent',
      claudeSessionId: 'cs-live',
      model: 'claude-opus-5-5',
      state: 'idle',
      events: [],
      partial: null,
      usage: null,
      forks: [],
      turnStartedAt: null,
    })

    await fireQueuedMessage(queuedMessage({ sessionId: 'sess-1', message: 'continue' }))

    expect(visualAgentApi.send).toHaveBeenCalledWith('sess-1:agent', 'continue')
    // No second agent when one is already running.
    expect(visualAgentApi.start).not.toHaveBeenCalled()
  })

  it('locates the session via electron-store when not in current project', async () => {
    const a = project({ id: 'proj-A', repoPath: '/repo/A' })
    const b = project({ id: 'proj-B', repoPath: '/repo/B' })
    const targetSess = session({ id: 'on-B', projectId: 'proj-B', name: 'b-sess' })
    persisted['proj-A'] = []
    persisted['proj-B'] = [targetSess]

    useProjectStore.setState({ projects: [a, b], activeProjectId: 'proj-A' } as any)
    useSessionStore.setState({ sessions: [], currentProjectId: 'proj-A' } as any)

    await fireQueuedMessage(queuedMessage({ sessionId: 'on-B', message: 'continue' }))

    // Project switched to B and sessions populated from disk
    // We don't yank the user's view to project B — but we do start the
    // visual agent for the right session.
    expect(visualAgentApi.start).toHaveBeenCalledTimes(1)
    expect(startCall().sessionId).toBe('on-B')
  })

  it('sends to the Claude Code on the web session for a cloud session, never a local agent', async () => {
    const cloudSend = vi.fn(async () => ({ sessionId: 'session_01abc', url: 'https://claude.ai/code/session_01abc' }))
    ;(window as any).api.cloudSession = { send: cloudSend }
    const sess = session({
      id: 'sess-c',
      projectId: 'proj-A',
      location: 'cloud',
      cloud: { sessionId: 'session_01abc', url: 'https://claude.ai/code/session_01abc' },
    } as any)
    persisted['proj-A'] = [sess]
    useProjectStore.setState({
      projects: [project({ claudeAccountId: 'acct-1' } as any)],
      activeProjectId: 'proj-A',
      claudeAccounts: [{ id: 'acct-1', configDir: '/cfg/acct-1' }],
    } as any)
    useSessionStore.setState({ sessions: [sess], currentProjectId: 'proj-A' } as any)

    await fireQueuedMessage(queuedMessage({ sessionId: 'sess-c', message: 'continue' }))

    expect(cloudSend).toHaveBeenCalledWith({
      worktreePath: sess.worktreePath,
      cloudSessionId: 'session_01abc',
      message: 'continue',
      configDir: '/cfg/acct-1',
    })
    expect(visualAgentApi.start).not.toHaveBeenCalled()
    expect(visualAgentApi.send).not.toHaveBeenCalled()
    expect(useToastStore.getState().toasts.some((t) => /cloud session/.test(t.message))).toBe(true)
  })

  it('a teleported (now local) session goes to the local visual agent again', async () => {
    const cloudSend = vi.fn()
    ;(window as any).api.cloudSession = { send: cloudSend }
    const sess = session({
      id: 'sess-t',
      projectId: 'proj-A',
      location: 'local',
      cloud: { sessionId: 'session_01abc', url: 'https://claude.ai/code/session_01abc', teleportedAt: '2026-10-21T00:00:00Z' },
    } as any)
    persisted['proj-A'] = [sess]
    useProjectStore.setState({ projects: [project()], activeProjectId: 'proj-A' } as any)
    useSessionStore.setState({ sessions: [sess], currentProjectId: 'proj-A' } as any)

    await fireQueuedMessage(queuedMessage({ sessionId: 'sess-t', message: 'continue' }))

    expect(cloudSend).not.toHaveBeenCalled()
    expect(visualAgentApi.start).toHaveBeenCalledTimes(1)
  })

  it('shows a toast when the session no longer exists', async () => {
    useProjectStore.setState({ projects: [project()], activeProjectId: 'proj-A' } as any)
    persisted['proj-A'] = []

    await fireQueuedMessage(queuedMessage({ sessionId: 'gone' }))

    const toasts = useToastStore.getState().toasts
    expect(toasts.some((t) => t.type === 'error' && /no longer exists/.test(t.message))).toBe(true)
  })
})
