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
