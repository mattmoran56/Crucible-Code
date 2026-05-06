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
import { useTerminalStore } from '../../../src/renderer/stores/terminalStore'
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

// Drive any registered onData listeners — used by the inject helper's prompt
// detection. Tests can call emitTerminalData('term-x', '> ') to simulate
// claude printing a prompt.
const dataListeners = new Set<(terminalId: string, data: string) => void>()
function emitTerminalData(terminalId: string, data: string): void {
  for (const cb of dataListeners) cb(terminalId, data)
}

let nextTerminalId = 1

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

// Mocks the bulletproof IPC the queued-session fire handler now uses:
// claude is spawned with the prompt piped via heredoc, claude consumes it,
// exits, and the mode='claude' onExit handler auto-restarts with --resume.
// The renderer never has to inject keystrokes via `>`-detection.
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
  spawnAgentWithPrompt: vi.fn(async (sessionId: string) => `term-${nextTerminalId++}-${sessionId}`),
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false })
  for (const k of Object.keys(persisted)) delete persisted[k]
  writeCalls.length = 0
  dataListeners.clear()
  nextTerminalId = 1

  sessionApi.list.mockClear()
  sessionApi.save.mockClear()
  worktreeApi.create.mockClear()
  terminalApi.write.mockClear()
  terminalApi.onData.mockClear()
  schedulerApi.spawnAgentWithPrompt.mockClear()

  ;(window as any).api = {
    session: sessionApi,
    worktree: worktreeApi,
    git: gitApi,
    terminal: terminalApi,
    scheduler: schedulerApi,
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
  useTerminalStore.setState({ terminals: {} } as any)
})

describe('fireQueuedSession', () => {
  it('creates the worktree, persists the session, and spawns claude with the prompt piped via heredoc', async () => {
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

    // Spawned via the heredoc-pipe IPC — the prompt arrives as claude's
    // stdin, no key-by-key injection needed.
    expect(schedulerApi.spawnAgentWithPrompt).toHaveBeenCalledTimes(1)
    const [sessionId, cwd, prompt] = schedulerApi.spawnAgentWithPrompt.mock.calls[0]
    expect(sessionId).toBe(state.sessions[0].id)
    expect(cwd).toBe(state.sessions[0].worktreePath)
    expect(prompt).toBe('go')

    // The spawned terminal is registered in the terminalStore so a later
    // TerminalPanel mount reuses this PTY rather than spawning a new one.
    const registered = useTerminalStore.getState().getTerminal(state.sessions[0].id, 'claude')
    expect(registered).toBeDefined()
  })

  it('skips the heredoc spawn when the queued session has no prompt', async () => {
    useProjectStore.setState({ projects: [project()], activeProjectId: 'proj-A' } as any)
    useSessionStore.setState({ currentProjectId: 'proj-A', sessions: [] } as any)
    persisted['proj-A'] = []
    await fireQueuedSession(queuedSession({ startupPrompt: '' }))
    expect(schedulerApi.spawnAgentWithPrompt).not.toHaveBeenCalled()
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
    // The new session did spawn a terminal under its own ID though.
    expect(schedulerApi.spawnAgentWithPrompt).toHaveBeenCalledTimes(1)
    expect(schedulerApi.spawnAgentWithPrompt.mock.calls[0][1]).toBe('/created/b-new') // cwd = worktreePath
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
  it('spawns a claude terminal with the message piped via heredoc when no terminal exists yet', async () => {
    const sess = session({ id: 'sess-1', projectId: 'proj-A' })
    persisted['proj-A'] = [sess]
    useProjectStore.setState({ projects: [project()], activeProjectId: 'proj-A' } as any)
    useSessionStore.setState({ sessions: [sess], currentProjectId: 'proj-A' } as any)

    await fireQueuedMessage(queuedMessage({ sessionId: 'sess-1', message: 'continue' }))

    expect(schedulerApi.spawnAgentWithPrompt).toHaveBeenCalledTimes(1)
    const terminalId = await schedulerApi.spawnAgentWithPrompt.mock.results[0].value
    const registered = useTerminalStore.getState().getTerminal('sess-1', 'claude')
    expect(registered?.terminalId).toBe(terminalId)
    expect(schedulerApi.spawnAgentWithPrompt.mock.calls[0][2]).toBe('continue')
  })

  it('writes directly to PTY when a claude terminal already exists', async () => {
    const sess = session({ id: 'sess-1', projectId: 'proj-A' })
    persisted['proj-A'] = [sess]
    useProjectStore.setState({ projects: [project()], activeProjectId: 'proj-A' } as any)
    useSessionStore.setState({ sessions: [sess], currentProjectId: 'proj-A' } as any)
    useTerminalStore.setState({
      terminals: {
        'sess-1:claude': {
          terminalId: 'term-7',
          sessionId: 'sess-1',
          sessionName: 'x',
          mode: 'claude',
          contextId: 'sess-1',
          tabId: 'agent',
        },
      },
    } as any)

    await fireQueuedMessage(queuedMessage({ sessionId: 'sess-1', message: 'continue' }))

    // The handler delays the write by 200ms — advance the clock to flush it.
    await vi.advanceTimersByTimeAsync(250)

    expect(terminalApi.write).toHaveBeenCalledWith('term-7', 'continue\r')
    // No second spawn when a live PTY already exists.
    expect(schedulerApi.spawnAgentWithPrompt).not.toHaveBeenCalled()
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
    // We don't yank the user's view to project B — but we do spawn the
    // claude terminal for the right session.
    expect(schedulerApi.spawnAgentWithPrompt).toHaveBeenCalledTimes(1)
    expect(schedulerApi.spawnAgentWithPrompt.mock.calls[0][0]).toBe('on-B')
  })

  it('shows a toast when the session no longer exists', async () => {
    useProjectStore.setState({ projects: [project()], activeProjectId: 'proj-A' } as any)
    persisted['proj-A'] = []

    await fireQueuedMessage(queuedMessage({ sessionId: 'gone' }))

    const toasts = useToastStore.getState().toasts
    expect(toasts.some((t) => t.type === 'error' && /no longer exists/.test(t.message))).toBe(true)
  })
})
