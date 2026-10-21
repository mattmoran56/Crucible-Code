// Cloud sessions in the session workspace: the core Agent tab shows the cloud
// panel (embedded claude.ai page + Teleport) for cloud sessions, teleport
// refuses a dirty tree and otherwise swaps the page for the teleport PTY and
// switches the session local, a branch change made by the teleport is
// followed (and cleanup only offered), and a session teleported in an
// earlier run resumes its discovered conversation as a visual agent.
import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VisualAgentStartOptions } from '../../../../src/shared/visual-agent'

vi.mock('../../../../src/renderer/components/visual-agent/VisualAgentPanel', () => ({
  VisualAgentPanel: ({ agentId, startOptions }: { agentId: string; startOptions: VisualAgentStartOptions }) => (
    <div data-testid="visual-agent" data-agent={agentId} data-resume={startOptions.resumeClaudeSessionId ?? ''} />
  ),
}))
vi.mock('../../../../src/renderer/components/terminal/TerminalView', () => ({
  TerminalView: ({ terminalId }: { terminalId: string }) => <div data-testid="terminal" data-terminal={terminalId} />,
}))
vi.mock('../../../../src/renderer/components/terminal/useTerminal', () => ({ destroyTerminal: vi.fn() }))
vi.mock('../../../../src/renderer/components/terminal/DynamicTerminalPanel', () => ({ DynamicTerminalPanel: () => null }))
vi.mock('../../../../src/renderer/components/terminal/ReviewTerminalPanel', () => ({ ReviewTerminalPanel: () => null }))
vi.mock('../../../../src/renderer/components/review-loop/ReviewLoopPanel', () => ({ ReviewLoopPanel: () => null }))
vi.mock('../../../../src/renderer/components/git/GitPanel', () => ({ GitPanel: () => null }))
vi.mock('../../../../src/renderer/components/pullrequests/PRReviewPanel', () => ({ PRReviewPanel: () => null }))
vi.mock('../../../../src/renderer/components/layout/WorkspaceColumn', () => ({
  ColumnPanel: ({ column }: { column: { id: string } }) => (
    <div data-column-id={column.id}>
      <div data-column-content />
    </div>
  ),
}))

import { SessionWorkspace } from '../../../../src/renderer/components/layout/SessionWorkspace'
import { CloudWebView } from '../../../../src/renderer/components/cloud/CloudWebView'
import { useCloudSessionStore } from '../../../../src/renderer/stores/cloudSessionStore'
import { useSessionStore } from '../../../../src/renderer/stores/sessionStore'
import { useProjectStore } from '../../../../src/renderer/stores/projectStore'
import { useWorkspaceLayoutStore } from '../../../../src/renderer/stores/workspaceLayoutStore'

const cloudSession = {
  id: 's1',
  name: 'feat',
  branchName: 'session/feat',
  worktreePath: '/wt/feat',
  projectId: 'p1',
  createdAt: '2026-10-21T00:00:00Z',
  location: 'cloud' as const,
  cloud: { sessionId: 'session_01abcdefgh', url: 'https://claude.ai/code/session_01abcdefgh' },
}

let dataListeners: Array<(id: string, data: string) => void>
let exitListeners: Array<(id: string, code: number) => void>
const api = {
  teleport: vi.fn(),
  discoverLocal: vi.fn(),
  send: vi.fn(async () => ({ sessionId: 'session_01abcdefgh', url: '' })),
  openUrl: vi.fn(async () => {}),
  create: vi.fn(),
}
const terminalSpawn = vi.fn(async () => 'term-x')
const save = vi.fn(async () => {})
const worktree = {
  currentBranch: vi.fn(async (): Promise<string | null> => 'session/feat'),
  deleteLocalBranch: vi.fn(async () => {}),
  deleteRemoteBranch: vi.fn(async () => {}),
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockClear()
  terminalSpawn.mockClear()
  save.mockClear()
  for (const fn of Object.values(worktree)) fn.mockClear()
  worktree.currentBranch.mockResolvedValue('session/feat')
  dataListeners = []
  exitListeners = []
  ;(window as any).api = {
    terminal: {
      spawn: terminalSpawn,
      write: vi.fn(),
      onData: (cb: (id: string, data: string) => void) => {
        dataListeners.push(cb)
        return () => (dataListeners = dataListeners.filter((x) => x !== cb))
      },
      onExit: (cb: (id: string, code: number) => void) => {
        exitListeners.push(cb)
        return () => (exitListeners = exitListeners.filter((x) => x !== cb))
      },
    },
    session: { save },
    cloudSession: api,
    worktree,
  }
  useProjectStore.setState({
    projects: [{ id: 'p1', name: 'acme', repoPath: '/repo', claudeAccountId: 'a1' }],
    activeProjectId: 'p1',
    claudeAccounts: [{ id: 'a1', name: 'Work', configDir: '/cfg/work' }],
  } as any)
  useSessionStore.setState({
    sessions: [cloudSession],
    currentProjectId: 'p1',
    activeSessionId: 's1',
    activePRNumber: null,
    openedAsMainBranch: null,
    didStash: false,
    pendingStartup: null,
  } as any)
  useCloudSessionStore.setState({ teleports: {}, branchNotices: {} })
  useWorkspaceLayoutStore.setState({ columns: [], savedLayouts: {} })
})

const panel = () => screen.queryByTestId('cloud-agent-panel')

describe('cloud session Agent tab', () => {
  it('shows the cloud panel with the claude.ai page instead of a visual agent or terminal', () => {
    render(<SessionWorkspace />)
    expect(panel()).not.toBeNull()
    expect(screen.queryByTestId('visual-agent')).toBeNull()
    expect(screen.queryByTestId('terminal')).toBeNull()
    // Outside Electron the <webview> is stubbed.
    expect(screen.getByTestId('cloud-web-stub').textContent).toMatch('https://claude.ai/code/session_01abcdefgh')
    expect(terminalSpawn).not.toHaveBeenCalled()
    expect(screen.getByText('Cloud')).toBeTruthy()
    expect(screen.getByText('01abcdef')).toBeTruthy()
    expect(screen.getByTestId('cloud-branch').textContent).toBe('session/feat')
    // No attach terminal, no follow-up box, no Reattach any more.
    expect(screen.queryByRole('button', { name: 'Reattach' })).toBeNull()
    expect(screen.queryByLabelText('Follow-up message')).toBeNull()
  })

  it('embeds a real <webview> on the claude-web partition inside Electron', () => {
    const ua = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 Chrome/130 Electron/33.4.11')
    try {
      render(<SessionWorkspace />)
      const view = screen.getByTestId('cloud-webview')
      expect(view.tagName.toLowerCase()).toBe('webview')
      expect(view.getAttribute('src')).toBe('https://claude.ai/code/session_01abcdefgh')
      expect(view.getAttribute('partition')).toBe('persist:claude-web')
      expect(view.getAttribute('allowpopups')).toBe('true')
      // Never a preload or Node in the guest from the renderer side either.
      expect(view.hasAttribute('preload')).toBe(false)
      expect(view.hasAttribute('nodeintegration')).toBe(false)
    } finally {
      ua.mockRestore()
    }
  })

  it('opens the session URL in the browser', async () => {
    render(<SessionWorkspace />)
    fireEvent.click(screen.getByRole('button', { name: /Open in browser/ }))
    expect(api.openUrl).toHaveBeenCalledWith('https://claude.ai/code/session_01abcdefgh')
  })

  it('teleport asks first, and refuses a dirty worktree without changing the session', async () => {
    api.teleport.mockResolvedValue({ ok: false, reason: 'dirty', files: ['src/a.ts', 'README.md'] })
    render(<SessionWorkspace />)
    fireEvent.click(screen.getByRole('button', { name: /Teleport/ }))
    expect(screen.getByRole('group', { name: 'Confirm teleport' }).textContent).toMatch(
      /Bring this session down to your machine\? It will continue locally in \/wt\/feat/
    )
    expect(api.teleport).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Teleport' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/uncommitted changes.*src\/a\.ts, README\.md/))
    expect(useSessionStore.getState().sessions[0].location).toBe('cloud')
    // Still showing the page.
    expect(screen.getByTestId('cloud-web-stub')).toBeTruthy()
    expect(save).not.toHaveBeenCalled()
  })

  it('teleport on a clean tree replaces the page with the teleport PTY and marks the session local', async () => {
    api.teleport.mockResolvedValue({ ok: true, terminalId: 'term-teleport' })
    render(<SessionWorkspace />)
    fireEvent.click(screen.getByRole('button', { name: /Teleport/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Teleport' }))
    await waitFor(() => expect(screen.getByTestId('terminal').dataset.terminal).toBe('term-teleport'))
    expect(screen.queryByTestId('cloud-web-view')).toBeNull()
    expect(api.teleport).toHaveBeenCalledWith(expect.objectContaining({ cloudSessionId: 'session_01abcdefgh', worktreePath: '/wt/feat' }))
    const s = useSessionStore.getState().sessions[0]
    expect(s.location).toBe('local')
    expect(s.cloud?.teleportedAt).toMatch(/^\d{4}-\d\d-\d\dT/)
    expect(s.cloud?.sessionId).toBe('session_01abcdefgh')
    // Still the teleport PTY this run, not a visual agent.
    expect(panel()).not.toBeNull()
    expect(screen.queryByTestId('visual-agent')).toBeNull()
    expect(screen.getByText('Teleported · Local')).toBeTruthy()
    expect(save).toHaveBeenCalled()

    // When the local session exits, the user can switch to a visual agent.
    api.discoverLocal.mockResolvedValue('local-claude-1')
    act(() => {
      for (const cb of exitListeners) cb('term-teleport', 0)
    })
    await waitFor(() => expect(worktree.currentBranch).toHaveBeenCalledWith('/wt/feat'))
    // Same branch: no notice, nothing renamed.
    expect(screen.queryByText(/Teleport checked out/)).toBeNull()
    expect(useSessionStore.getState().sessions[0].branchName).toBe('session/feat')
    fireEvent.click(screen.getByRole('button', { name: 'Continue as local agent' }))
    await waitFor(() => expect(screen.getByTestId('visual-agent').dataset.resume).toBe('local-claude-1'))
  })

  it('follows a different branch checked out by the teleport, and only offers cleanup', async () => {
    api.teleport.mockResolvedValue({ ok: true, terminalId: 'term-teleport' })
    worktree.currentBranch.mockResolvedValue('claude/feat-xyz')
    render(<SessionWorkspace />)
    fireEvent.click(screen.getByRole('button', { name: /Teleport/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Teleport' }))
    await waitFor(() => expect(screen.getByTestId('terminal')).toBeTruthy())
    act(() => {
      for (const cb of exitListeners) cb('term-teleport', 0)
    })
    await waitFor(() => expect(screen.getByText(/Teleport checked out/)).toBeTruthy())
    expect(useSessionStore.getState().sessions[0].branchName).toBe('claude/feat-xyz')
    expect(screen.getByTestId('cloud-branch').textContent).toBe('claude/feat-xyz')
    // Nothing deleted until the user asks, and confirms.
    expect(worktree.deleteLocalBranch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Delete unused branch…' }))
    expect(worktree.deleteLocalBranch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(worktree.deleteRemoteBranch).toHaveBeenCalledWith('/repo', 'session/feat'))
    expect(worktree.deleteLocalBranch).toHaveBeenCalledWith('/repo', 'session/feat')
  })

  it('a failed teleport shows the error and can be dismissed back to the page', async () => {
    api.teleport.mockRejectedValue(new Error('boom'))
    render(<SessionWorkspace />)
    fireEvent.click(screen.getByRole('button', { name: /Teleport/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Teleport' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Teleport failed: boom/))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByTestId('cloud-web-stub')).toBeTruthy()
  })

  it('keeps one page per cloud session and hides it when another session is active', () => {
    const other = { ...cloudSession, id: 's2', name: 'other', cloud: { sessionId: 'session_02zzzzzzzz', url: 'https://claude.ai/code/session_02zzzzzzzz' } }
    useSessionStore.setState({ sessions: [cloudSession, other], activeSessionId: 's2' } as any)
    render(<SessionWorkspace />)
    const views = screen.getAllByTestId('cloud-web-view')
    // s1 was never shown, so its page isn't created; s2's is visible.
    const stubs = screen.getAllByTestId('cloud-web-stub')
    expect(stubs).toHaveLength(1)
    expect(stubs[0].textContent).toMatch('session_02zzzzzzzz')
    expect(views.filter((v) => !v.className.includes('hidden'))).toHaveLength(1)
  })
})

describe('CloudWebView', () => {
  const renderView = (visible = true) => {
    const onOpen = vi.fn()
    const utils = render(<CloudWebView url="https://claude.ai/code/session_01abc" visible={visible} onOpenInBrowser={onOpen} embed />)
    return { ...utils, onOpen, view: () => screen.getByTestId('cloud-webview') }
  }
  const fire = (el: Element, type: string, props: Record<string, unknown> = {}) =>
    act(() => {
      el.dispatchEvent(Object.assign(new Event(type), props))
    })

  it('shows a spinner until the page has loaded', () => {
    const { view } = renderView()
    expect(screen.getByRole('status').textContent).toMatch(/Loading claude\.ai/)
    fire(view(), 'did-stop-loading')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('shows Retry and Open in browser when the main frame fails, ignoring aborted and sub-frame loads', () => {
    const { view, onOpen } = renderView()
    fire(view(), 'did-fail-load', { errorCode: -3, errorDescription: 'ERR_ABORTED', isMainFrame: true })
    fire(view(), 'did-fail-load', { errorCode: -105, errorDescription: 'ERR_NAME_NOT_RESOLVED', isMainFrame: false })
    expect(screen.queryByRole('alert')).toBeNull()
    fire(view(), 'did-fail-load', { errorCode: -106, errorDescription: 'ERR_INTERNET_DISCONNECTED', isMainFrame: true })
    expect(screen.getByRole('alert').textContent).toMatch(/ERR_INTERNET_DISCONNECTED/)
    fireEvent.click(screen.getByRole('button', { name: /Open in browser/ }))
    expect(onOpen).toHaveBeenCalled()
    const before = view()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(screen.queryByRole('alert')).toBeNull()
    // A fresh webview is created for the retry.
    expect(view()).not.toBe(before)
    expect(screen.getByRole('status')).toBeTruthy()
  })

  it('is not created until first shown, then stays (hidden) while switching away', () => {
    const { rerender } = render(<CloudWebView url="https://claude.ai/code/x" visible={false} onOpenInBrowser={() => {}} embed />)
    expect(screen.queryByTestId('cloud-webview')).toBeNull()
    rerender(<CloudWebView url="https://claude.ai/code/x" visible onOpenInBrowser={() => {}} embed />)
    const view = screen.getByTestId('cloud-webview')
    rerender(<CloudWebView url="https://claude.ai/code/x" visible={false} onOpenInBrowser={() => {}} embed />)
    expect(screen.getByTestId('cloud-webview')).toBe(view)
    expect(screen.getByTestId('cloud-web-view').className).toMatch(/hidden/)
  })
})

describe('session teleported in an earlier run', () => {
  const teleported = {
    ...cloudSession,
    location: 'local' as const,
    cloud: { ...cloudSession.cloud, teleportedAt: '2026-10-21T09:00:00.000Z' },
  }

  it('discovers the local Claude session and resumes it as a visual agent', async () => {
    useSessionStore.setState({ sessions: [teleported] } as any)
    api.discoverLocal.mockResolvedValue('abcd-1234')
    render(<SessionWorkspace />)
    await waitFor(() => expect(screen.getByTestId('visual-agent').dataset.resume).toBe('abcd-1234'))
    expect(api.discoverLocal).toHaveBeenCalledWith({
      worktreePath: '/wt/feat',
      configDir: '/cfg/work',
      since: '2026-10-21T09:00:00.000Z',
    })
    const s = useSessionStore.getState().sessions[0]
    expect(s.visualAgents?.agent?.claudeSessionId).toBe('abcd-1234')
    expect(s.cloud?.localResumeResolved).toBe(true)
  })

  it('follows the branch the earlier teleport checked out', async () => {
    useSessionStore.setState({ sessions: [teleported] } as any)
    api.discoverLocal.mockResolvedValue('abcd-1234')
    worktree.currentBranch.mockResolvedValue('claude/other')
    render(<SessionWorkspace />)
    await waitFor(() => expect(screen.getByTestId('visual-agent')).toBeTruthy())
    expect(useSessionStore.getState().sessions[0].branchName).toBe('claude/other')
    expect(worktree.deleteLocalBranch).not.toHaveBeenCalled()
  })

  it('falls back to a fresh visual agent when nothing is found, and does not retry', async () => {
    useSessionStore.setState({ sessions: [teleported] } as any)
    api.discoverLocal.mockResolvedValue(null)
    render(<SessionWorkspace />)
    await waitFor(() => expect(screen.getByTestId('visual-agent').dataset.resume).toBe(''))
    expect(useSessionStore.getState().sessions[0].cloud?.localResumeResolved).toBe(true)
    expect(api.discoverLocal).toHaveBeenCalledTimes(1)
  })
})
