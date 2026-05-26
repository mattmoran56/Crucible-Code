/**
 * Integration test for the renderer-side Notion fire path.
 *
 * Drives the full chain: NOTION_FIRE_TASK arrives → useNotionBootstrap reacts
 * → useSessionStore.createSession is called with the resolved startup prompt
 * → applyWriteBack IPC is invoked with the new branch + session id.
 *
 * Mocks the IPC layer (window.api) and the worktree/session backends, so
 * this is the layer between unit tests (notion.service / notion-poller /
 * notionStore) and the full Playwright e2e flow.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useNotionBootstrap } from '../../../src/renderer/hooks/useNotionBootstrap'
import { useProjectStore } from '../../../src/renderer/stores/projectStore'
import { useSessionStore } from '../../../src/renderer/stores/sessionStore'
import { useTerminalStore } from '../../../src/renderer/stores/terminalStore'
import { useToastStore } from '../../../src/renderer/stores/toastStore'
import type { NotionFireTaskPayload, Session } from '../../../src/shared/types'

const spawnTerminalMock = vi.fn(async () => 'terminal-1')

let fireListeners: Array<(payload: NotionFireTaskPayload) => void> = []
const persisted: Record<string, Session[]> = {}
const applyWriteBackMock = vi.fn(async () => {})

const sessionApi = {
  list: vi.fn(async (projectId: string) =>
    persisted[projectId] ? [...persisted[projectId]] : []
  ),
  save: vi.fn(async (projectId: string, sessions: Session[]) => {
    persisted[projectId] = [...sessions]
  }),
  saveContext: vi.fn(async () => {}),
  getContext: vi.fn(async () => null),
}

const worktreeApi = {
  create: vi.fn(async (_repo: string, name: string) => ({
    path: `/created/${name}`,
    branch: `notion/${name}`,
  })),
  remove: vi.fn(async () => {}),
}

const terminalApi = {
  write: vi.fn(async () => {}),
  killSession: vi.fn(async () => {}),
  onData: vi.fn(() => () => {}),
}

const notionApi = {
  loadConfig: vi.fn(async () => null),
  saveConfig: vi.fn(async () => {}),
  testConnection: vi.fn(async () => ({ ok: true })),
  getDatabaseSchema: vi.fn(async () => null),
  applyWriteBack: applyWriteBackMock,
  clearPickedUp: vi.fn(async () => {}),
  getConfigPath: vi.fn(async () => '/mock/notion-integration.json'),
  onFireTask: vi.fn((cb: (payload: NotionFireTaskPayload) => void) => {
    fireListeners.push(cb)
    return () => {
      fireListeners = fireListeners.filter((f) => f !== cb)
    }
  }),
}

beforeEach(() => {
  fireListeners = []
  for (const k of Object.keys(persisted)) delete persisted[k]
  sessionApi.list.mockClear()
  sessionApi.save.mockClear()
  worktreeApi.create.mockClear()
  applyWriteBackMock.mockClear()
  notionApi.onFireTask.mockClear()
  spawnTerminalMock.mockClear()
  // Stub spawnTerminal on the terminal store. The real implementation talks
  // to the main process; we just need the new bootstrap path to be able to
  // call it without crashing.
  useTerminalStore.setState({ spawnTerminal: spawnTerminalMock as any })

  ;(window as any).api = {
    session: sessionApi,
    worktree: worktreeApi,
    terminal: terminalApi,
    notion: notionApi,
  }

  useProjectStore.setState({
    projects: [
      { id: 'proj-A', name: 'A', repoPath: '/repo/A' },
      { id: 'proj-B', name: 'B', repoPath: '/repo/B' },
    ],
    activeProjectId: 'proj-A',
    claudeAccounts: [],
  } as any)
  // currentProjectId must match payload.projectId for createSession to write
  // pendingStartup — otherwise it bails early (cross-project safety).
  useSessionStore.setState({
    sessions: [],
    currentProjectId: 'proj-A',
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

const payload: NotionFireTaskPayload = {
  projectId: 'proj-A',
  page: {
    id: 'page-1',
    url: 'https://notion.so/page-1',
    title: 'Hello World',
    rawProperties: {},
  },
  resolvedStartupPrompt: '/notion-ticket https://notion.so/page-1',
  suggestedBranchName: 'notion/hello-world',
  suggestedSessionName: 'hello-world',
}

describe('useNotionBootstrap', () => {
  it('subscribes to onFireTask on mount and unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useNotionBootstrap())
    expect(notionApi.onFireTask).toHaveBeenCalledTimes(1)
    expect(fireListeners).toHaveLength(1)
    unmount()
    expect(fireListeners).toHaveLength(0)
  })

  it('on fire: creates a session and spawns the claude terminal so writeWhenReady can inject the prompt', async () => {
    renderHook(() => useNotionBootstrap())
    await act(async () => {
      await fireListeners[0](payload)
    })
    expect(worktreeApi.create).toHaveBeenCalledWith('/repo/A', 'hello-world', undefined)
    expect(sessionApi.save).toHaveBeenCalledTimes(1)
    const saved = persisted['proj-A']
    expect(saved).toHaveLength(1)
    expect(saved[0].branchName).toBe('notion/hello-world')
    // The bootstrap proactively spawns the terminal so the prompt can be
    // injected via writeWhenReady (same approach as the review tab), instead
    // of relying on sessionStore.pendingStartup which is a single slot.
    expect(spawnTerminalMock).toHaveBeenCalledTimes(1)
    const spawnArgs = spawnTerminalMock.mock.calls[0]
    expect(spawnArgs[2]).toBe('/created/hello-world')
    expect(spawnArgs[3]).toBe('claude')
  })

  it('calls applyWriteBack with the new branch and session id', async () => {
    renderHook(() => useNotionBootstrap())
    await act(async () => {
      await fireListeners[0](payload)
    })
    expect(applyWriteBackMock).toHaveBeenCalledTimes(1)
    const args = applyWriteBackMock.mock.calls[0]
    expect(args[0]).toBe('proj-A')
    expect(args[1]).toEqual(payload.page)
    // branch comes from the worktree creation, not the suggested name — those
    // can drift (e.g. if there's a collision the worktree service suffixes).
    expect(args[2]).toBe('notion/hello-world')
    // sessionId is the new uuid; just assert it's a non-empty string.
    expect(typeof args[3]).toBe('string')
    expect(args[3].length).toBeGreaterThan(0)
  })

  it('skips the fire silently when the project was removed since the poller emitted', async () => {
    renderHook(() => useNotionBootstrap())
    useProjectStore.setState({ projects: [], activeProjectId: null } as any)
    await act(async () => {
      await fireListeners[0](payload)
    })
    expect(worktreeApi.create).not.toHaveBeenCalled()
    expect(applyWriteBackMock).not.toHaveBeenCalled()
  })

  it('toasts an error if session creation throws', async () => {
    worktreeApi.create.mockRejectedValueOnce(new Error('worktree exists'))
    renderHook(() => useNotionBootstrap())
    await act(async () => {
      await fireListeners[0](payload)
    })
    const toasts = useToastStore.getState().toasts
    expect(toasts.some((t) => t.type === 'error' && /worktree exists/.test(t.message))).toBe(true)
    expect(applyWriteBackMock).not.toHaveBeenCalled()
  })

  it('shows an info toast when a task is picked up', async () => {
    renderHook(() => useNotionBootstrap())
    await act(async () => {
      await fireListeners[0](payload)
    })
    const toasts = useToastStore.getState().toasts
    expect(toasts.some((t) => t.type === 'info' && /Hello World/.test(t.message))).toBe(true)
  })
})
