import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionStore } from '../../../src/renderer/stores/sessionStore'

const sessionApi = {
  list: vi.fn(),
  save: vi.fn(),
  saveContext: vi.fn(),
  getContext: vi.fn(),
}
const gitApi = {
  status: vi.fn(),
  checkout: vi.fn(),
  restoreWorktree: vi.fn(),
}
const worktreeApi = {
  create: vi.fn(),
  remove: vi.fn(),
  createFromBranch: vi.fn(),
  createForPR: vi.fn(),
  listPR: vi.fn(),
  removePR: vi.fn(),
}
const terminalApi = {
  killSession: vi.fn(),
}

beforeEach(() => {
  for (const o of [sessionApi, gitApi, worktreeApi, terminalApi]) {
    for (const fn of Object.values(o)) (fn as any).mockReset()
  }
  ;(window as any).api = {
    session: sessionApi,
    git: gitApi,
    worktree: worktreeApi,
    terminal: terminalApi,
  }
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
})

describe('sessionStore.consumePendingStartup', () => {
  it('returns and clears the queued command for a matching session', () => {
    useSessionStore.setState({
      pendingStartup: { sessionId: 's1', command: 'npm test' },
    } as any)
    expect(useSessionStore.getState().consumePendingStartup('s1')).toBe('npm test')
    expect(useSessionStore.getState().pendingStartup).toBeNull()
  })

  it('returns null for non-matching sessions and leaves the queue intact', () => {
    useSessionStore.setState({
      pendingStartup: { sessionId: 's1', command: 'npm test' },
    } as any)
    expect(useSessionStore.getState().consumePendingStartup('s2')).toBeNull()
    expect(useSessionStore.getState().pendingStartup).not.toBeNull()
  })
})

describe('sessionStore.consumePendingFocus', () => {
  it('returns true (and clears) only for a matching session id', () => {
    useSessionStore.setState({ pendingFocusSessionId: 's1' } as any)
    expect(useSessionStore.getState().consumePendingFocus('s2')).toBe(false)
    expect(useSessionStore.getState().consumePendingFocus('s1')).toBe(true)
    expect(useSessionStore.getState().pendingFocusSessionId).toBeNull()
  })
})

describe('sessionStore.setActiveWorkspaceTab', () => {
  it('sets the active workspace tab', () => {
    useSessionStore.getState().setActiveWorkspaceTab('git' as any)
    expect(useSessionStore.getState().activeWorkspaceTab).toBe('git')
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Extended coverage (appended). Imports below are hoisted by ESM semantics.
// ───────────────────────────────────────────────────────────────────────────
import { useToastStore } from '../../../src/renderer/stores/toastStore'
import { useTerminalStore } from '../../../src/renderer/stores/terminalStore'

const S = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name: `name-${id}`,
  branchName: `session/name-${id}`,
  worktreePath: `/wt/${id}`,
  projectId: 'p1',
  createdAt: '2024-01-01T00:00:00.000Z',
  lastActiveAt: '2024-01-01T00:00:00.000Z',
  ...overrides,
}) as any

const savedCtx = (overrides: Record<string, unknown> = {}) => ({
  sessionId: null,
  prNumber: null,
  openedAsMainBranch: null,
  previousMainBranch: null,
  detachedWorktree: null,
  didStash: false,
  ...overrides,
})

describe('sessionStore.loadSessions', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
  })

  it('stores sessions sorted by createdAt descending and sets currentProjectId', async () => {
    sessionApi.list.mockResolvedValue([
      S('old', { createdAt: '2024-01-01T00:00:00.000Z' }),
      S('new', { createdAt: '2024-03-01T00:00:00.000Z' }),
      S('mid', { createdAt: '2024-02-01T00:00:00.000Z' }),
    ])
    await useSessionStore.getState().loadSessions('p1')
    const s = useSessionStore.getState()
    expect(s.sessions.map((x) => x.id)).toEqual(['new', 'mid', 'old'])
    expect(s.currentProjectId).toBe('p1')
  })

  it('falls back to the first (newest) session when there is no saved context', async () => {
    sessionApi.list.mockResolvedValue([
      S('a', { createdAt: '2024-01-01T00:00:00.000Z' }),
      S('b', { createdAt: '2024-02-01T00:00:00.000Z' }),
    ])
    await useSessionStore.getState().loadSessions('p1')
    expect(useSessionStore.getState().activeSessionId).toBe('b')
    expect(useSessionStore.getState().activePRNumber).toBeNull()
    expect(useSessionStore.getState().activeWorkspaceTab).toBe('agent')
  })

  it('leaves activeSessionId null when the project has no sessions', async () => {
    sessionApi.list.mockResolvedValue([])
    await useSessionStore.getState().loadSessions('p1')
    expect(useSessionStore.getState().activeSessionId).toBeNull()
    expect(useSessionStore.getState().sessions).toEqual([])
  })

  it('keeps the current selection and tab on a same-project reload', async () => {
    useSessionStore.setState({
      currentProjectId: 'p1',
      activeSessionId: 's1',
      activePRNumber: 3,
      activeWorkspaceTab: 'pr',
      didStash: true,
      openedAsMainBranch: 's1',
      previousMainBranch: 'main',
      detachedWorktree: { worktreePath: '/wt/s1', branch: 'b' },
    } as any)
    sessionApi.list.mockResolvedValue([S('s1')])
    await useSessionStore.getState().loadSessions('p1')
    const s = useSessionStore.getState()
    expect(s.activeSessionId).toBe('s1')
    expect(s.activePRNumber).toBe(3)
    expect(s.activeWorkspaceTab).toBe('pr')
    expect(s.didStash).toBe(true)
    expect(s.openedAsMainBranch).toBe('s1')
    expect(s.previousMainBranch).toBe('main')
    expect(s.detachedWorktree).toEqual({ worktreePath: '/wt/s1', branch: 'b' })
  })

  it('does not save the outgoing context when reloading the same project', async () => {
    useSessionStore.setState({ currentProjectId: 'p1', activeSessionId: 's1' } as any)
    sessionApi.list.mockResolvedValue([S('s1')])
    await useSessionStore.getState().loadSessions('p1')
    expect(sessionApi.saveContext).not.toHaveBeenCalled()
  })

  it('saves the outgoing project context when switching to a different project', async () => {
    useSessionStore.setState({
      currentProjectId: 'p1',
      activeSessionId: 's1',
      activePRNumber: 9,
      didStash: true,
    } as any)
    sessionApi.list.mockResolvedValue([])
    await useSessionStore.getState().loadSessions('p2')
    expect(sessionApi.saveContext).toHaveBeenCalledWith('p1', expect.objectContaining({
      sessionId: 's1',
      prNumber: 9,
      didStash: true,
    }))
  })

  it('restores a saved session selection when returning to a project', async () => {
    sessionApi.list.mockResolvedValue([S('s1'), S('s2')])
    sessionApi.getContext.mockResolvedValue(savedCtx({ sessionId: 's2' }))
    await useSessionStore.getState().loadSessions('p1')
    expect(useSessionStore.getState().activeSessionId).toBe('s2')
    expect(useSessionStore.getState().activeWorkspaceTab).toBe('agent')
  })

  it('restores a saved PR context with the pr workspace tab', async () => {
    sessionApi.list.mockResolvedValue([S('s1')])
    sessionApi.getContext.mockResolvedValue(savedCtx({ prNumber: 7 }))
    await useSessionStore.getState().loadSessions('p1')
    const s = useSessionStore.getState()
    expect(s.activeSessionId).toBeNull()
    expect(s.activePRNumber).toBe(7)
    expect(s.activeWorkspaceTab).toBe('pr')
  })

  it('restores saved main-branch bookkeeping when returning to a project', async () => {
    sessionApi.list.mockResolvedValue([S('s1')])
    sessionApi.getContext.mockResolvedValue(savedCtx({
      sessionId: 's1',
      openedAsMainBranch: 's1',
      previousMainBranch: 'develop',
      detachedWorktree: { worktreePath: '/wt/s1', branch: 'session/name-s1' },
      didStash: true,
    }))
    await useSessionStore.getState().loadSessions('p1')
    const s = useSessionStore.getState()
    expect(s.openedAsMainBranch).toBe('s1')
    expect(s.previousMainBranch).toBe('develop')
    expect(s.detachedWorktree).toEqual({ worktreePath: '/wt/s1', branch: 'session/name-s1' })
    expect(s.didStash).toBe(true)
  })

  it('falls back to the first session when the saved session id is stale and no PR is saved', async () => {
    sessionApi.list.mockResolvedValue([S('real')])
    sessionApi.getContext.mockResolvedValue(savedCtx({ sessionId: 'ghost' }))
    await useSessionStore.getState().loadSessions('p1')
    expect(useSessionStore.getState().activeSessionId).toBe('real')
  })

  it('still restores main-branch state from a stale saved context (current behavior)', async () => {
    sessionApi.list.mockResolvedValue([S('real')])
    sessionApi.getContext.mockResolvedValue(savedCtx({
      sessionId: 'ghost',
      openedAsMainBranch: 'ghost',
      didStash: true,
    }))
    await useSessionStore.getState().loadSessions('p1')
    expect(useSessionStore.getState().openedAsMainBranch).toBe('ghost')
    expect(useSessionStore.getState().didStash).toBe(true)
  })

  it('discards a stale list response when a newer loadSessions started afterwards', async () => {
    let resolveFirst: (v: any) => void = () => {}
    sessionApi.list.mockImplementationOnce(() => new Promise((r) => { resolveFirst = r }))
    const first = useSessionStore.getState().loadSessions('p1')
    sessionApi.list.mockResolvedValueOnce([S('b1', { projectId: 'p2' })])
    await useSessionStore.getState().loadSessions('p2')
    resolveFirst([S('a1')])
    await first
    const s = useSessionStore.getState()
    expect(s.currentProjectId).toBe('p2')
    expect(s.sessions.map((x) => x.id)).toEqual(['b1'])
  })
})

describe('sessionStore.createSession', () => {
  beforeEach(() => {
    useSessionStore.setState({ currentProjectId: 'p1' } as any)
    worktreeApi.create.mockResolvedValue({ path: '/wt/new', branch: 'session/feat' })
    useToastStore.setState({ toasts: [] })
  })

  it('creates a worktree, appends the session and makes it active on the agent tab', async () => {
    await useSessionStore.getState().createSession('p1', '/repo', 'feat')
    const s = useSessionStore.getState()
    expect(worktreeApi.create).toHaveBeenCalledWith('/repo', 'feat', undefined)
    expect(s.sessions).toHaveLength(1)
    expect(s.sessions[0]).toMatchObject({
      name: 'feat',
      branchName: 'session/feat',
      worktreePath: '/wt/new',
      projectId: 'p1',
    })
    expect(s.activeSessionId).toBe(s.sessions[0].id)
    expect(s.activePRNumber).toBeNull()
    expect(s.activeWorkspaceTab).toBe('agent')
    expect(sessionApi.save).toHaveBeenCalledWith('p1', s.sessions)
  })

  it('sorts the new session ahead of older ones', async () => {
    useSessionStore.setState({
      sessions: [S('old', { createdAt: '2000-01-01T00:00:00.000Z' })],
    } as any)
    await useSessionStore.getState().createSession('p1', '/repo', 'feat')
    expect(useSessionStore.getState().sessions[0].name).toBe('feat')
    expect(useSessionStore.getState().sessions[1].id).toBe('old')
  })

  it('queues a pending startup command and focus for the new session', async () => {
    await useSessionStore.getState().createSession('p1', '/repo', 'feat', 'main', 'claude --resume')
    const s = useSessionStore.getState()
    expect(s.pendingStartup).toEqual({ sessionId: s.activeSessionId, command: 'claude --resume' })
    expect(s.pendingFocusSessionId).toBe(s.activeSessionId)
  })

  it('leaves pendingStartup null when no startup command is given', async () => {
    await useSessionStore.getState().createSession('p1', '/repo', 'feat')
    expect(useSessionStore.getState().pendingStartup).toBeNull()
  })

  it('records baseBranch and notionTicket on the created session', async () => {
    const ticket = { pageId: 'pg1', url: 'https://notion.so/pg1', title: 'Ticket' }
    await useSessionStore.getState().createSession('p1', '/repo', 'feat', 'develop', undefined, ticket as any)
    const created = useSessionStore.getState().sessions[0] as any
    expect(created.baseBranch).toBe('develop')
    expect(created.notionTicket).toEqual(ticket)
  })

  it('persists a fresh last-active context for the project', async () => {
    await useSessionStore.getState().createSession('p1', '/repo', 'feat')
    const id = useSessionStore.getState().activeSessionId
    expect(sessionApi.saveContext).toHaveBeenCalledWith('p1', {
      sessionId: id,
      prNumber: null,
      prWorktreePath: null,
      openedAsMainBranch: null,
      previousMainBranch: null,
      detachedWorktree: null,
      didStash: false,
    })
  })

  it('restores a previously detached worktree and clears it before activating', async () => {
    useSessionStore.setState({
      detachedWorktree: { worktreePath: '/wt/other', branch: 'feature/z' },
    } as any)
    await useSessionStore.getState().createSession('p1', '/repo', 'feat')
    expect(gitApi.restoreWorktree).toHaveBeenCalledWith('/wt/other', 'feature/z')
    expect(useSessionStore.getState().detachedWorktree).toBeNull()
  })

  it('saves but does not activate when the user switched projects mid-create', async () => {
    useSessionStore.setState({ currentProjectId: 'p2', activeSessionId: null } as any)
    await useSessionStore.getState().createSession('p1', '/repo', 'feat')
    expect(sessionApi.save).toHaveBeenCalled()
    expect(useSessionStore.getState().sessions).toEqual([])
    expect(useSessionStore.getState().activeSessionId).toBeNull()
  })
})

describe('sessionStore.removeSession', () => {
  beforeEach(() => {
    useSessionStore.setState({
      currentProjectId: 'p1',
      sessions: [S('s1'), S('s2')],
      activeSessionId: 's1',
    } as any)
    useTerminalStore.setState({ terminals: {} })
  })

  it('removes the worktree, kills session terminals and persists the filtered list', async () => {
    await useSessionStore.getState().removeSession('p1', '/repo', 's1')
    expect(worktreeApi.remove).toHaveBeenCalledWith('/repo', '/wt/s1')
    expect(terminalApi.killSession).toHaveBeenCalledWith('s1')
    expect(sessionApi.save).toHaveBeenCalledWith('p1', [expect.objectContaining({ id: 's2' })])
    expect(useSessionStore.getState().sessions.map((x) => x.id)).toEqual(['s2'])
  })

  it('activates the first remaining session when removing the active one', async () => {
    await useSessionStore.getState().removeSession('p1', '/repo', 's1')
    expect(useSessionStore.getState().activeSessionId).toBe('s2')
  })

  it('keeps the current active session when removing a different one', async () => {
    await useSessionStore.getState().removeSession('p1', '/repo', 's2')
    expect(useSessionStore.getState().activeSessionId).toBe('s1')
  })

  it('clears activeSessionId when the last session is removed', async () => {
    useSessionStore.setState({ sessions: [S('s1')], activeSessionId: 's1' } as any)
    await useSessionStore.getState().removeSession('p1', '/repo', 's1')
    expect(useSessionStore.getState().activeSessionId).toBeNull()
  })

  it('swallows worktree removal errors and still deletes the session', async () => {
    worktreeApi.remove.mockRejectedValue(new Error('already gone'))
    await useSessionStore.getState().removeSession('p1', '/repo', 's1')
    expect(useSessionStore.getState().sessions.map((x) => x.id)).toEqual(['s2'])
  })

  it('skips the worktree removal for an unknown session id but still persists', async () => {
    await useSessionStore.getState().removeSession('p1', '/repo', 'ghost')
    expect(worktreeApi.remove).not.toHaveBeenCalled()
    expect(terminalApi.killSession).toHaveBeenCalledWith('ghost')
    expect(sessionApi.save).toHaveBeenCalled()
    expect(useSessionStore.getState().sessions).toHaveLength(2)
  })

  it('drops renderer terminal registrations belonging to the removed session', async () => {
    useTerminalStore.setState({
      terminals: {
        's1:claude': { terminalId: 't1', sessionId: 's1', sessionName: 'n', mode: 'claude', contextId: 's1', tabId: 'agent' },
        's2:shell': { terminalId: 't2', sessionId: 's2', sessionName: 'n', mode: 'shell', contextId: 's2', tabId: 'agent' },
      },
    } as any)
    await useSessionStore.getState().removeSession('p1', '/repo', 's1')
    expect(Object.keys(useTerminalStore.getState().terminals)).toEqual(['s2:shell'])
  })

  it('does not touch visible state when the project changed mid-removal', async () => {
    useSessionStore.setState({ currentProjectId: 'p9' } as any)
    await useSessionStore.getState().removeSession('p1', '/repo', 's1')
    expect(sessionApi.save).toHaveBeenCalled()
    expect(useSessionStore.getState().sessions).toHaveLength(2)
  })
})

describe('sessionStore.renameSession', () => {
  beforeEach(() => {
    ;(worktreeApi as any).renameBranch = vi.fn()
    ;(window as any).api.worktree.renameBranch = (worktreeApi as any).renameBranch
    useSessionStore.setState({
      currentProjectId: 'p1',
      sessions: [S('s1', { name: 'alpha', branchName: 'session/alpha' }), S('s2', { name: 'beta' })],
    } as any)
  })

  it('rejects an empty (whitespace-only) name', async () => {
    await expect(useSessionStore.getState().renameSession('p1', '/repo', 's1', '   '))
      .rejects.toThrow('Name cannot be empty')
  })

  it('rejects names with characters outside the allowed set', async () => {
    await expect(useSessionStore.getState().renameSession('p1', '/repo', 's1', 'has space'))
      .rejects.toThrow('Name can only contain letters, numbers, dots, dashes, underscores and slashes')
  })

  it('rejects renames of unknown sessions', async () => {
    await expect(useSessionStore.getState().renameSession('p1', '/repo', 'ghost', 'x'))
      .rejects.toThrow('Session not found')
  })

  it('rejects a name already used by another session', async () => {
    await expect(useSessionStore.getState().renameSession('p1', '/repo', 's1', 'beta'))
      .rejects.toThrow('Another session already uses this name')
  })

  it('returns early without touching git when the name is unchanged', async () => {
    await useSessionStore.getState().renameSession('p1', '/repo', 's1', 'alpha')
    expect(worktreeApi.renameBranch).not.toHaveBeenCalled()
    expect(sessionApi.save).not.toHaveBeenCalled()
  })

  it('renames the branch to session/<name> and persists the updated session', async () => {
    worktreeApi.renameBranch = vi.fn().mockResolvedValue({ newBranch: 'session/gamma' })
    ;(window as any).api.worktree.renameBranch = worktreeApi.renameBranch
    await useSessionStore.getState().renameSession('p1', '/repo', 's1', 'gamma')
    expect(worktreeApi.renameBranch).toHaveBeenCalledWith('/repo', '/wt/s1', 'session/alpha', 'session/gamma')
    const renamed = useSessionStore.getState().sessions.find((x) => x.id === 's1')!
    expect(renamed.name).toBe('gamma')
    expect(renamed.branchName).toBe('session/gamma')
    expect(sessionApi.save).toHaveBeenCalled()
  })

  it('trims surrounding whitespace before validating and renaming', async () => {
    worktreeApi.renameBranch = vi.fn().mockResolvedValue({ newBranch: 'session/neat' })
    ;(window as any).api.worktree.renameBranch = worktreeApi.renameBranch
    await useSessionStore.getState().renameSession('p1', '/repo', 's1', '  neat  ')
    expect(useSessionStore.getState().sessions.find((x) => x.id === 's1')!.name).toBe('neat')
  })

  it('accepts dots, dashes, underscores and slashes in names', async () => {
    worktreeApi.renameBranch = vi.fn().mockResolvedValue({ newBranch: 'session/feat/x-1.2_z' })
    ;(window as any).api.worktree.renameBranch = worktreeApi.renameBranch
    await useSessionStore.getState().renameSession('p1', '/repo', 's1', 'feat/x-1.2_z')
    expect(useSessionStore.getState().sessions.find((x) => x.id === 's1')!.name).toBe('feat/x-1.2_z')
  })
})

describe('sessionStore.setActiveSession', () => {
  beforeEach(() => {
    useSessionStore.setState({ currentProjectId: 'p1' } as any)
    useToastStore.setState({ toasts: [] })
  })

  it('activates the session, clears PR state and resets stash/detached bookkeeping', async () => {
    useSessionStore.setState({
      activePRNumber: 4,
      activeWorkspaceTab: 'pr',
      didStash: true,
      detachedWorktree: { worktreePath: '/wt/x', branch: 'b' },
    } as any)
    await useSessionStore.getState().setActiveSession('s1')
    const s = useSessionStore.getState()
    expect(s.activeSessionId).toBe('s1')
    expect(s.activePRNumber).toBeNull()
    expect(s.activeWorkspaceTab).toBe('agent')
    expect(s.didStash).toBe(false)
    expect(s.detachedWorktree).toBeNull()
    expect(gitApi.restoreWorktree).toHaveBeenCalledWith('/wt/x', 'b')
  })

  it('preserves main-branch mode without restoring the worktree', async () => {
    useSessionStore.setState({
      openedAsMainBranch: 's9',
      didStash: true,
      detachedWorktree: { worktreePath: '/wt/x', branch: 'b' },
    } as any)
    await useSessionStore.getState().setActiveSession('s1')
    const s = useSessionStore.getState()
    expect(s.activeSessionId).toBe('s1')
    expect(s.openedAsMainBranch).toBe('s9')
    expect(s.didStash).toBe(true)
    expect(s.detachedWorktree).toEqual({ worktreePath: '/wt/x', branch: 'b' })
    expect(gitApi.restoreWorktree).not.toHaveBeenCalled()
  })

  it('persists the selection in the project context', async () => {
    await useSessionStore.getState().setActiveSession('s1')
    expect(sessionApi.saveContext).toHaveBeenCalledWith('p1', expect.objectContaining({
      sessionId: 's1',
      prNumber: null,
    }))
  })

  it('does not persist a context when no project is current', async () => {
    useSessionStore.setState({ currentProjectId: null } as any)
    await useSessionStore.getState().setActiveSession('s1')
    expect(sessionApi.saveContext).not.toHaveBeenCalled()
  })

  it('toasts but still activates when restoring the detached worktree fails', async () => {
    useSessionStore.setState({
      detachedWorktree: { worktreePath: '/wt/x', branch: 'b' },
    } as any)
    gitApi.restoreWorktree.mockRejectedValue(new Error('locked'))
    await useSessionStore.getState().setActiveSession('s1')
    expect(useToastStore.getState().toasts[0]).toMatchObject({
      type: 'error',
      message: 'Failed to restore worktree branch: locked',
    })
    expect(useSessionStore.getState().activeSessionId).toBe('s1')
  })
})

describe('sessionStore.openPR / closePR', () => {
  const PR = { number: 5, headRefName: 'feat/x' } as any

  beforeEach(() => {
    useSessionStore.setState({ currentProjectId: 'p1', activeSessionId: 's1' } as any)
    useToastStore.setState({ toasts: [] })
    worktreeApi.createForPR.mockResolvedValue({ path: '/wt/pr-5', branch: 'feat/x' })
  })

  it('creates a PR worktree and switches to the pr tab', async () => {
    await useSessionStore.getState().openPR('/repo', PR)
    const s = useSessionStore.getState()
    expect(worktreeApi.createForPR).toHaveBeenCalledWith('/repo', 5, 'feat/x')
    expect(s.activeSessionId).toBeNull()
    expect(s.activePRNumber).toBe(5)
    expect(s.activeWorkspaceTab).toBe('pr')
  })

  it('records the created worktree path on the active PR state', async () => {
    await useSessionStore.getState().openPR('/repo', PR)
    expect(useSessionStore.getState().activePRWorktreePath).toBe('/wt/pr-5')
  })

  it('surfaces a worktree-creation failure as a toast but still opens the PR', async () => {
    worktreeApi.createForPR.mockRejectedValue(new Error('dirty tree'))
    await useSessionStore.getState().openPR('/repo', PR)
    expect(useToastStore.getState().toasts[0]).toMatchObject({
      type: 'error',
      message: 'Failed to open PR worktree: dirty tree',
    })
    expect(useSessionStore.getState().activePRNumber).toBe(5)
  })

  it('leaves the worktree path null when creation throws', async () => {
    worktreeApi.createForPR.mockRejectedValue(new Error('boom'))
    await useSessionStore.getState().openPR('/repo', PR)
    const s = useSessionStore.getState()
    expect(s.activePRNumber).toBe(5)
    expect(s.activePRWorktreePath).toBeNull()
    expect(s.didStash).toBe(false)
    expect(s.detachedWorktree).toBeNull()
  })

  it('does not commit the path back if the user navigated away mid-creation', async () => {
    let resolveCreate: (v: { path: string; branch: string }) => void = () => {}
    worktreeApi.createForPR.mockReturnValue(
      new Promise((res) => {
        resolveCreate = res
      })
    )
    const p = useSessionStore.getState().openPR('/repo', PR)
    // Simulate the user closing the PR before createForPR resolves.
    useSessionStore.setState({ activePRNumber: null } as any)
    resolveCreate({ path: '/wt/pr-5', branch: 'feat/x' })
    await p
    expect(useSessionStore.getState().activePRWorktreePath).toBeNull()
  })

  it('persists the PR number and worktree path in the project context', async () => {
    await useSessionStore.getState().openPR('/repo', PR)
    expect(sessionApi.saveContext).toHaveBeenCalledWith('p1', expect.objectContaining({
      sessionId: null,
      prNumber: 5,
      prWorktreePath: '/wt/pr-5',
    }))
  })

  it('closePR clears the PR and worktree path and persists without restoring', async () => {
    useSessionStore.setState({
      activePRNumber: 5,
      activeSessionId: 's1',
      activePRWorktreePath: '/wt/pr-5',
    } as any)
    await useSessionStore.getState().closePR()
    // The worktree is left in place for the reconcile path; closePR no longer
    // restores anything.
    expect(gitApi.restoreWorktree).not.toHaveBeenCalled()
    expect(useSessionStore.getState().activePRNumber).toBeNull()
    expect(useSessionStore.getState().activePRWorktreePath).toBeNull()
    expect(sessionApi.saveContext).toHaveBeenCalledWith('p1', expect.objectContaining({
      sessionId: 's1',
      prNumber: null,
      prWorktreePath: null,
    }))
  })
})

describe('sessionStore.openAsMainBranch / returnToWorktree', () => {
  beforeEach(() => {
    useSessionStore.setState({
      currentProjectId: 'p1',
      sessions: [S('s1', { branchName: 'session/alpha' })],
    } as any)
    useToastStore.setState({ toasts: [] })
  })

  it('remembers the previous main branch and flags the session as opened-as-main', async () => {
    gitApi.status.mockResolvedValue({ current: 'main' })
    gitApi.checkout.mockResolvedValue({ stashed: true, detachedWorktree: '/wt/s1' })
    await useSessionStore.getState().openAsMainBranch('/repo', 's1')
    const s = useSessionStore.getState()
    expect(gitApi.checkout).toHaveBeenCalledWith('/repo', 'session/alpha')
    expect(s.openedAsMainBranch).toBe('s1')
    expect(s.previousMainBranch).toBe('main')
    expect(s.activeSessionId).toBe('s1')
    expect(s.activePRNumber).toBeNull()
    expect(s.didStash).toBe(true)
    expect(s.detachedWorktree).toEqual({ worktreePath: '/wt/s1', branch: 'session/alpha' })
  })

  it('is a no-op for unknown session ids', async () => {
    await useSessionStore.getState().openAsMainBranch('/repo', 'ghost')
    expect(gitApi.status).not.toHaveBeenCalled()
    expect(useSessionStore.getState().openedAsMainBranch).toBeNull()
  })

  it('toasts and leaves main-branch state untouched when the checkout throws', async () => {
    gitApi.status.mockResolvedValue({ current: 'main' })
    gitApi.checkout.mockRejectedValue(new Error('conflict'))
    await useSessionStore.getState().openAsMainBranch('/repo', 's1')
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: 'error', message: 'conflict' })
    expect(useSessionStore.getState().openedAsMainBranch).toBeNull()
  })

  it('returnToWorktree restores the main branch first, then the worktree, then clears state', async () => {
    const calls: string[] = []
    gitApi.checkout.mockImplementation(async (_repo: string, branch: string) => {
      calls.push(`checkout:${branch}`)
      return { stashed: false, detachedWorktree: null }
    })
    gitApi.restoreWorktree.mockImplementation(async (path: string) => {
      calls.push(`restore:${path}`)
    })
    useSessionStore.setState({
      openedAsMainBranch: 's1',
      previousMainBranch: 'main',
      detachedWorktree: { worktreePath: '/wt/s1', branch: 'session/alpha' },
      didStash: true,
    } as any)
    await useSessionStore.getState().returnToWorktree('/repo')
    expect(calls).toEqual(['checkout:main', 'restore:/wt/s1'])
    const s = useSessionStore.getState()
    expect(s.openedAsMainBranch).toBeNull()
    expect(s.previousMainBranch).toBeNull()
    expect(s.detachedWorktree).toBeNull()
    expect(s.didStash).toBe(false)
  })

  it('returnToWorktree skips the checkout when no previous branch was recorded', async () => {
    useSessionStore.setState({ openedAsMainBranch: 's1', previousMainBranch: null } as any)
    await useSessionStore.getState().returnToWorktree('/repo')
    expect(gitApi.checkout).not.toHaveBeenCalled()
    expect(useSessionStore.getState().openedAsMainBranch).toBeNull()
  })

  it('returnToWorktree toasts on checkout failure but still clears state', async () => {
    gitApi.checkout.mockRejectedValue(new Error('nope'))
    useSessionStore.setState({ openedAsMainBranch: 's1', previousMainBranch: 'main', didStash: true } as any)
    await useSessionStore.getState().returnToWorktree('/repo')
    expect(useToastStore.getState().toasts[0]).toMatchObject({
      type: 'error',
      message: 'Failed to restore main branch: nope',
    })
    expect(useSessionStore.getState().didStash).toBe(false)
  })
})

describe('sessionStore.clearActiveContext', () => {
  it('resets all selection and main-branch state and persists an empty context', async () => {
    useSessionStore.setState({
      currentProjectId: 'p1',
      activeSessionId: 's1',
      activePRNumber: 4,
      activeWorkspaceTab: 'pr',
      didStash: true,
      detachedWorktree: { worktreePath: '/wt/x', branch: 'b' },
      openedAsMainBranch: 's1',
      previousMainBranch: 'main',
    } as any)
    await useSessionStore.getState().clearActiveContext()
    const s = useSessionStore.getState()
    expect(gitApi.restoreWorktree).toHaveBeenCalledWith('/wt/x', 'b')
    expect(s.activeSessionId).toBeNull()
    expect(s.activePRNumber).toBeNull()
    expect(s.activeWorkspaceTab).toBe('agent')
    expect(s.didStash).toBe(false)
    expect(s.detachedWorktree).toBeNull()
    expect(s.openedAsMainBranch).toBeNull()
    expect(s.previousMainBranch).toBeNull()
    expect(sessionApi.saveContext).toHaveBeenCalledWith('p1', {
      sessionId: null,
      prNumber: null,
      prWorktreePath: null,
      openedAsMainBranch: null,
      previousMainBranch: null,
      detachedWorktree: null,
      didStash: false,
    })
  })

  it('skips context persistence when no project is current', async () => {
    useSessionStore.setState({ currentProjectId: null, activeSessionId: 's1' } as any)
    await useSessionStore.getState().clearActiveContext()
    expect(sessionApi.saveContext).not.toHaveBeenCalled()
    expect(useSessionStore.getState().activeSessionId).toBeNull()
  })
})

describe('sessionStore.openBranch / importWorktree', () => {
  beforeEach(() => {
    useSessionStore.setState({ currentProjectId: 'p1' } as any)
  })

  it('openBranch creates a worktree from the branch and activates the new session', async () => {
    worktreeApi.createFromBranch.mockResolvedValue({ path: '/wt/legacy', branch: 'feature/legacy' })
    await useSessionStore.getState().openBranch('p1', '/repo', 'feature/legacy', 'legacy-work')
    const s = useSessionStore.getState()
    expect(worktreeApi.createFromBranch).toHaveBeenCalledWith('/repo', 'legacy-work', 'feature/legacy')
    expect(s.sessions[0]).toMatchObject({
      name: 'legacy-work',
      branchName: 'feature/legacy',
      worktreePath: '/wt/legacy',
    })
    expect(s.activeSessionId).toBe(s.sessions[0].id)
    expect(s.activeWorkspaceTab).toBe('agent')
    expect(sessionApi.save).toHaveBeenCalled()
    expect(sessionApi.saveContext).toHaveBeenCalledWith('p1', expect.objectContaining({ sessionId: s.sessions[0].id }))
  })

  it('openBranch does not activate when the project changed mid-flight', async () => {
    worktreeApi.createFromBranch.mockResolvedValue({ path: '/wt/x', branch: 'b' })
    useSessionStore.setState({ currentProjectId: 'p2' } as any)
    await useSessionStore.getState().openBranch('p1', '/repo', 'b', 'n')
    expect(useSessionStore.getState().sessions).toEqual([])
  })

  it('importWorktree derives the session name from the directory basename', async () => {
    await useSessionStore.getState().importWorktree('p1', { path: '/repos/wt/my-feature', branch: 'feat/import' } as any)
    const s = useSessionStore.getState()
    expect(s.sessions[0]).toMatchObject({
      name: 'my-feature',
      branchName: 'feat/import',
      worktreePath: '/repos/wt/my-feature',
    })
    expect(s.activeSessionId).toBe(s.sessions[0].id)
  })

  it('importWorktree falls back to the branch name when the path ends with a slash', async () => {
    await useSessionStore.getState().importWorktree('p1', { path: '/repos/wt/', branch: 'feat/slashy' } as any)
    expect(useSessionStore.getState().sessions[0].name).toBe('feat/slashy')
  })
})

describe('sessionStore.queuePendingStartup', () => {
  it('overwrites any previously queued startup command', () => {
    useSessionStore.getState().queuePendingStartup('s1', 'first')
    useSessionStore.getState().queuePendingStartup('s2', 'second')
    expect(useSessionStore.getState().pendingStartup).toEqual({ sessionId: 's2', command: 'second' })
  })

  it('queued command is consumable by the matching session', () => {
    useSessionStore.getState().queuePendingStartup('s1', 'npm run dev')
    expect(useSessionStore.getState().consumePendingStartup('s1')).toBe('npm run dev')
  })

  it('consumePendingStartup returns null when nothing is queued', () => {
    expect(useSessionStore.getState().consumePendingStartup('s1')).toBeNull()
  })

  it('consumePendingFocus returns false when nothing is pending', () => {
    expect(useSessionStore.getState().consumePendingFocus('s1')).toBe(false)
  })
})
