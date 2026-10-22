// Cloud sessions in the session workspace: the core Agent tab shows the cloud
// panel (embedded claude.ai page + Teleport) for cloud sessions, teleport
// refuses a dirty tree and otherwise swaps the page for the "Teleporting…"
// view over the teleport PTY and switches the session local; once the run is
// done the tab resumes the local conversation as a visual agent. A branch
// change made by the teleport is followed (and cleanup only offered), and a
// session teleported in an earlier run resumes its discovered conversation.
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
const focusTerminal = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/renderer/components/terminal/useTerminal', () => ({ destroyTerminal: vi.fn(), focusTerminal }))
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
import { CloudWebPool } from '../../../../src/renderer/components/cloud/CloudWebPool'
import { useCloudWebPoolStore } from '../../../../src/renderer/stores/cloudWebPoolStore'
import { useCloudSessionStore } from '../../../../src/renderer/stores/cloudSessionStore'
import { cloudCreatedPatch, useCloudCreateBootstrap } from '../../../../src/renderer/lib/cloudCreate'
import { _resetAppliedTeleports } from '../../../../src/renderer/lib/cloudTeleport'
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
let teleportListeners: Array<(state: any) => void>
const api = {
  teleport: vi.fn(),
  teleportState: vi.fn(async (): Promise<any> => null),
  finishTeleport: vi.fn(async (): Promise<any> => null),
  onTeleportEvent: vi.fn((cb: (state: any) => void) => {
    teleportListeners.push(cb)
    return () => (teleportListeners = teleportListeners.filter((x) => x !== cb))
  }),
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
  teleportListeners = []
  _resetAppliedTeleports()
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
  useCloudSessionStore.setState({ teleports: {}, teleportRuns: {}, branchNotices: {} })
  useCloudWebPoolStore.setState({ entries: {}, claims: {} })
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
      // The page itself lives in the app-root pool, laid over the Agent tab.
      render(
        <>
          <CloudWebPool />
          <SessionWorkspace />
        </>
      )
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

  const teleportRun = (patch: Record<string, unknown> = {}) => ({
    sessionId: 's1',
    projectId: 'p1',
    terminalId: 'term-teleport',
    status: 'running',
    steps: [],
    startedAt: '2026-10-21T10:00:00.000Z',
    ...patch,
  })
  const emitTeleport = (patch: Record<string, unknown>) =>
    act(() => teleportListeners.forEach((cb) => cb(teleportRun(patch))))
  function Boot() {
    useCloudCreateBootstrap()
    return <SessionWorkspace />
  }
  const startTeleport = async () => {
    api.teleport.mockResolvedValue({ ok: true, terminalId: 'term-teleport', state: teleportRun() })
    render(<Boot />)
    fireEvent.click(screen.getByRole('button', { name: /Teleport/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Teleport' }))
    await waitFor(() => expect(screen.getByTestId('teleport-progress')).toBeTruthy())
  }

  it('teleport on a clean tree shows progress over the PTY, then resumes the conversation as a visual agent', async () => {
    await startTeleport()
    expect(screen.getByTestId('terminal').dataset.terminal).toBe('term-teleport')
    expect(screen.queryByTestId('cloud-web-view')).toBeNull()
    expect(api.teleport).toHaveBeenCalledWith(
      expect.objectContaining({ cloudSessionId: 'session_01abcdefgh', worktreePath: '/wt/feat', projectId: 'p1' })
    )
    const s = useSessionStore.getState().sessions[0]
    expect(s.location).toBe('local')
    expect(s.cloud?.teleportedAt).toBe('2026-10-21T10:00:00.000Z')
    expect(s.cloud?.sessionId).toBe('session_01abcdefgh')
    expect(screen.getByText('Teleported · Local')).toBeTruthy()
    // The terminal is there but collapsed behind the step list.
    expect(screen.getByTestId('teleport-terminal-toggle').getAttribute('aria-expanded')).toBe('false')

    emitTeleport({ steps: ['Validating session', 'Fetching session logs'] })
    const steps = () =>
      [...screen.getByRole('list', { name: 'Teleport progress' }).querySelectorAll('li')].map((li) => li.dataset.state)
    expect(steps()).toEqual(['done', 'done', 'active', 'todo', 'todo', 'todo', 'todo'])

    // The CLI is done: the tab becomes the visual agent on the local conversation.
    emitTeleport({ status: 'done', claudeSessionId: 'local-claude-1', steps: ['Session resumed'] })
    await waitFor(() => expect(screen.getByTestId('visual-agent').dataset.resume).toBe('local-claude-1'))
    expect(screen.queryByTestId('teleport-progress')).toBeNull()
    const after = useSessionStore.getState().sessions[0]
    expect(after.visualAgents?.agent?.claudeSessionId).toBe('local-claude-1')
    expect(after.cloud?.localResumeResolved).toBe(true)
    expect(useCloudSessionStore.getState().teleports).toEqual({})
    expect(api.discoverLocal).not.toHaveBeenCalled()
  })

  it('reveals the terminal when the CLI asks something; nothing saved yet, so it offers Cancel, not the Agent view', async () => {
    await startTeleport()
    emitTeleport({ status: 'needs-input', steps: ['Validating session'] })
    expect(screen.getByTestId('teleport-terminal-toggle').getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText(/Claude needs your input/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Open in Agent view' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel teleport' }))
    expect(api.finishTeleport).toHaveBeenCalledWith('s1')
  })

  it('hands over when Claude has the conversation but has not saved it: terminal shown, only Cancel until saved', async () => {
    await startTeleport()
    // The REPL is up but nothing is on disk yet (before the hand-over too).
    emitTeleport({ status: 'running', steps: ['Validating session', 'Session resumed'] })
    expect(screen.queryByTestId('teleport-finish')).toBeNull()
    expect(screen.getByTestId('teleport-cancel')).toBeTruthy()
    emitTeleport({ status: 'needs-input', waiting: 'first-message', steps: ['Validating session', 'Session resumed'] })
    expect(screen.getByTestId('teleport-terminal-toggle').getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText(/saves the conversation locally only after your first message/)).toBeTruthy()
    // The user missed that in the status line: say it right above the
    // terminal, put the cursor there, and the panel header follows the run.
    expect(screen.getByTestId('teleport-send-message').textContent).toMatch(/Send any message below to finish bringing this session down/)
    await waitFor(() => expect(focusTerminal).toHaveBeenCalled())
    expect(screen.getByText(/waiting for your message/)).toBeTruthy()
    expect(screen.queryByText(/teleporting…/)).toBeNull()
    // Regression: "Open in Agent view" here closed the CLI with nothing saved,
    // which read as the teleport terminating on its way to the Agent view.
    expect(screen.queryByTestId('teleport-finish')).toBeNull()
    expect(screen.getByTestId('teleport-cancel').getAttribute('title')).toMatch(/stays in the cloud/)
    // After the first message Claude saved it: now it can open in the Agent view.
    emitTeleport({ status: 'needs-input', waiting: 'first-message', claudeSessionId: 'local-claude-5', steps: ['Session resumed'] })
    expect(screen.getByText(/Saved locally — open it/)).toBeTruthy()
    expect(screen.getByText(/saved locally — open in Agent view/)).toBeTruthy()
    expect(screen.queryByTestId('teleport-send-message')).toBeNull()
    expect(screen.queryByTestId('teleport-cancel')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open in Agent view' }))
    expect(api.finishTeleport).toHaveBeenCalledWith('s1')
    emitTeleport({ status: 'done', claudeSessionId: 'local-claude-5', steps: ['Session resumed'] })
    await waitFor(() => expect(screen.getByTestId('visual-agent').dataset.resume).toBe('local-claude-5'))
  })

  it('a stalled teleport says so, with the terminal and a way out', async () => {
    await startTeleport()
    emitTeleport({ status: 'needs-input', waiting: 'timeout', steps: ['Validating session'] })
    expect(screen.getByText(/taking longer than expected/)).toBeTruthy()
    expect(screen.getByTestId('teleport-terminal-toggle').getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel teleport' }))
    expect(api.finishTeleport).toHaveBeenCalledWith('s1')
    // Ended with nothing saved: abandoned, back to the cloud page with a retry.
    emitTeleport({ status: 'done', steps: ['Validating session'] })
    await waitFor(() => expect(screen.getByTestId('teleport-incomplete')).toBeTruthy())
    expect(screen.queryByTestId('visual-agent')).toBeNull()
    expect(screen.getByTestId('cloud-web-stub')).toBeTruthy()
  })

  it('an abandoned teleport goes back to the cloud page with a notice, and Teleport again retries', async () => {
    await startTeleport()
    emitTeleport({ status: 'needs-input', waiting: 'first-message', steps: ['Session resumed'] })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel teleport' }))
    emitTeleport({ status: 'done', steps: ['Session resumed'] })
    await waitFor(() => expect(screen.getByTestId('teleport-incomplete').textContent).toMatch(
      /Teleport didn't finish — nothing was saved locally/
    ))
    expect(screen.queryByTestId('teleport-progress')).toBeNull()
    expect(screen.queryByTestId('visual-agent')).toBeNull()
    expect(screen.getByTestId('cloud-web-stub')).toBeTruthy()
    expect(screen.getByText('Cloud')).toBeTruthy()
    expect(screen.getByTestId('cloud-branch').textContent).toBe('session/feat')
    const s = useSessionStore.getState().sessions[0]
    expect(s.location).toBe('cloud')
    expect(s.cloud).toEqual({
      sessionId: 'session_01abcdefgh',
      url: 'https://claude.ai/code/session_01abcdefgh',
      teleportIncomplete: true,
    })
    expect(s.visualAgents).toBeUndefined()
    expect(useCloudSessionStore.getState().teleports).toEqual({})

    // Retry: same confirm and clean-tree check; the notice goes away.
    api.teleport.mockResolvedValue({ ok: true, terminalId: 'term-teleport-2', state: teleportRun({ terminalId: 'term-teleport-2', startedAt: '2026-10-21T11:00:00.000Z' }) })
    fireEvent.click(screen.getByRole('button', { name: /Teleport again/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Teleport' }))
    await waitFor(() => expect(screen.getByTestId('teleport-progress')).toBeTruthy())
    expect(api.teleport).toHaveBeenCalledTimes(2)
    const retried = useSessionStore.getState().sessions[0]
    expect(retried.location).toBe('local')
    expect(retried.cloud?.teleportedAt).toBe('2026-10-21T11:00:00.000Z')
    expect(retried.cloud?.teleportIncomplete).toBeUndefined()
    expect(screen.queryByTestId('teleport-incomplete')).toBeNull()
  })

  it('a teleport that ends early shows why, and closing it resumes whatever Claude saved', async () => {
    await startTeleport()
    emitTeleport({ status: 'failed', error: 'Teleport ended (exit 1) before the conversation came down:\nnope' })
    expect(screen.getByRole('alert').textContent).toMatch(/before the conversation came down/)
    api.discoverLocal.mockResolvedValue('local-claude-2')
    fireEvent.click(screen.getByRole('button', { name: 'Close teleport' }))
    await waitFor(() => expect(screen.getByTestId('visual-agent').dataset.resume).toBe('local-claude-2'))
    expect(api.discoverLocal).toHaveBeenCalledWith(expect.objectContaining({ since: '2026-10-21T10:00:00.000Z' }))
  })

  it('picks the run back up from the main process after a remount', async () => {
    useSessionStore.setState({
      sessions: [{ ...cloudSession, location: 'local', cloud: { ...cloudSession.cloud, teleportedAt: '2026-10-21T10:00:00.000Z' } }],
    } as any)
    useCloudSessionStore.getState().setTeleport('s1', 'term-teleport')
    api.teleportState.mockResolvedValue(teleportRun({ steps: ['Validating session', 'Fetching session logs', 'Getting branch info'] }))
    render(<Boot />)
    await waitFor(() =>
      expect(
        [...screen.getByRole('list', { name: 'Teleport progress' }).querySelectorAll('li')].map((li) => li.dataset.state)
      ).toEqual(['done', 'done', 'done', 'active', 'todo', 'todo', 'todo'])
    )
    expect(api.teleportState).toHaveBeenCalledWith('s1')
  })

  it('follows a different branch checked out by the teleport, and only offers cleanup', async () => {
    api.teleport.mockResolvedValue({ ok: true, terminalId: 'term-teleport', state: teleportRun() })
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
    expect(useSessionStore.getState().sessions[0].ownsBranch).toBe(false)
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
  // The page's states (spinner, failure, retry, switching) are covered in
  // cloud-web-pool.test.tsx; here, the placeholder side.
  const view = (visible: boolean) => (
    <>
      <CloudWebPool />
      <CloudWebView sessionId="s1" url="https://claude.ai/code/x" visible={visible} embed />
    </>
  )

  it('opens Open in browser through the app when the page fails', () => {
    render(view(true))
    act(() => {
      screen.getByTestId('cloud-webview').dispatchEvent(Object.assign(new Event('did-fail-load'), { errorCode: -106, errorDescription: 'ERR_INTERNET_DISCONNECTED', isMainFrame: true }))
    })
    // (jsdom has no layout, so the page counts as off screen: query by text.)
    fireEvent.click(screen.getByText(/Open in browser/))
    expect(api.openUrl).toHaveBeenCalledWith('https://claude.ai/code/x')
  })

  it('is not created until first shown, then stays (hidden) while switching away', () => {
    const { rerender } = render(view(false))
    expect(screen.queryByTestId('cloud-webview')).toBeNull()
    rerender(view(true))
    const page = screen.getByTestId('cloud-webview')
    rerender(view(false))
    expect(screen.getByTestId('cloud-webview')).toBe(page)
    expect(screen.getByTestId('cloud-web-slot').style.visibility).toBe('hidden')
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

  it('goes back to the cloud page (not a fresh agent) when nothing was saved locally', async () => {
    useSessionStore.setState({ sessions: [teleported] } as any)
    api.discoverLocal.mockResolvedValue(null)
    render(<SessionWorkspace />)
    await waitFor(() => expect(screen.getByTestId('teleport-incomplete')).toBeTruthy())
    expect(screen.queryByTestId('visual-agent')).toBeNull()
    expect(screen.getByTestId('cloud-web-stub')).toBeTruthy()
    const s = useSessionStore.getState().sessions[0]
    expect(s.location).toBe('cloud')
    expect(s.cloud?.teleportedAt).toBeUndefined()
    expect(s.cloud?.teleportIncomplete).toBe(true)
    expect(api.discoverLocal).toHaveBeenCalledTimes(1)
  })

  it('the pool re-adds the claude.ai page once an abandoned teleport is back in the cloud', async () => {
    const ua = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 Chrome/130 Electron/33.4.11')
    try {
      useSessionStore.setState({ sessions: [teleported] } as any)
      api.discoverLocal.mockResolvedValue(null)
      render(
        <>
          <CloudWebPool />
          <SessionWorkspace />
        </>
      )
      await waitFor(() => expect(screen.getByTestId('cloud-webview').getAttribute('src')).toBe(cloudSession.cloud.url))
      expect(useCloudWebPoolStore.getState().entries.s1).toBeTruthy()
    } finally {
      ua.mockRestore()
    }
  })

  it('Dismiss hides the incomplete-teleport notice', async () => {
    useSessionStore.setState({
      sessions: [{ ...cloudSession, cloud: { ...cloudSession.cloud, teleportIncomplete: true } }],
    } as any)
    render(<SessionWorkspace />)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(screen.queryByTestId('teleport-incomplete')).toBeNull())
    expect(useSessionStore.getState().sessions[0].cloud?.teleportIncomplete).toBeUndefined()
  })
})

describe('creating a cloud session in the Agent tab', () => {
  const pendingSession = {
    ...cloudSession,
    id: 's2',
    cloud: undefined,
    cloudPending: { task: 'fix the bug', branch: 'session/feat', createdAt: '2026-10-21T00:00:00Z' },
  }
  const ID = 'session_01NewCloudSess'
  let createListeners: Array<(state: any) => void>
  const running = { sessionId: 's2', projectId: 'p1', terminalId: 'term-c1', status: 'running', attached: true }
  const emit = (state: any) => act(() => createListeners.forEach((cb) => cb(state)))

  function Boot() {
    useCloudCreateBootstrap()
    return <SessionWorkspace />
  }

  beforeEach(() => {
    createListeners = []
    const w = (window as any).api
    w.cloudSession = {
      ...api,
      start: vi.fn(async () => running),
      createState: vi.fn(async () => null),
      onCreateEvent: (cb: (s: any) => void) => {
        createListeners.push(cb)
        return () => (createListeners = createListeners.filter((x) => x !== cb))
      },
    }
    w.terminal.kill = vi.fn(async () => {})
    useSessionStore.setState({ sessions: [pendingSession], activeSessionId: 's2' } as any)
    useCloudSessionStore.setState({ creates: {}, autoStart: {} })
  })

  it('a just-created session starts the interactive CLI in a visible terminal, then switches to claude.ai', async () => {
    useCloudSessionStore.getState().requestAutoStart('s2')
    render(<Boot />)
    const w = (window as any).api
    await waitFor(() => expect(w.cloudSession.start).toHaveBeenCalledTimes(1))
    expect(w.cloudSession.start).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 's2',
        projectId: 'p1',
        worktreePath: '/wt/feat',
        branch: 'session/feat',
        task: 'fix the bug',
        configDir: '/cfg/work',
        repoPath: '/repo',
      })
    )
    await waitFor(() => expect(screen.getByTestId('terminal').getAttribute('data-terminal')).toBe('term-c1'))
    expect(screen.getByText(/Answer anything Claude asks/)).toBeTruthy()
    expect(screen.queryByTestId('cloud-web-stub')).toBeNull()

    emit({ ...running, status: 'created', result: { sessionId: ID, url: `https://claude.ai/code/${ID}`, branch: 'session/feat' } })
    await waitFor(() => expect(screen.getByTestId('cloud-web-stub').textContent).toMatch(ID))
    const saved = useSessionStore.getState().sessions[0]
    expect(saved.cloud).toEqual({ sessionId: ID, url: `https://claude.ai/code/${ID}`, branch: 'session/feat' })
    expect(saved.cloudPending).toBeUndefined()
    expect(save).toHaveBeenCalled()

    // The CLI stayed attached: it can be shown, and closed (never killed for the user).
    expect(screen.getByTestId('cloud-cli-attached')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Show terminal' }))
    expect(screen.getByTestId('terminal').getAttribute('data-terminal')).toBe('term-c1')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(w.terminal.kill).toHaveBeenCalledWith('term-c1')
    emit({ ...running, status: 'created', attached: false, result: { sessionId: ID, url: `https://claude.ai/code/${ID}` } })
    await waitFor(() => expect(screen.queryByTestId('cloud-cli-attached')).toBeNull())
  })

  it('a failed create keeps the worktree and offers Retry, claude.ai/code and Delete', async () => {
    useCloudSessionStore.getState().requestAutoStart('s2')
    const removeSession = vi.fn(async () => {})
    useSessionStore.setState({ removeSession } as any)
    render(<Boot />)
    const w = (window as any).api
    await waitFor(() => expect(w.cloudSession.start).toHaveBeenCalled())
    emit({ ...running, status: 'failed', attached: false, error: 'Claude did not create a cloud session (exit 1):\nError: not signed in' })
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/not signed in/))
    expect(screen.getByRole('alert').textContent).toMatch(/worktree and branch are kept/)
    // The terminal scrollback stays visible under the error.
    expect(screen.getByTestId('terminal')).toBeTruthy()
    expect(useSessionStore.getState().sessions[0].cloudPending).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Open claude.ai\/code/ }))
    expect(w.cloudSession.openUrl).toHaveBeenCalledWith('https://claude.ai/code')

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(w.cloudSession.start).toHaveBeenCalledTimes(2))

    emit({ ...running, status: 'failed', attached: false, error: 'boom' })
    fireEvent.click(await screen.findByRole('button', { name: 'Delete session…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(removeSession).toHaveBeenCalledWith('p1', '/repo', 's2', { deleteRemoteBranch: true }))
  })

  it('after an app restart a pending session waits for the user instead of re-running the CLI', async () => {
    render(<Boot />)
    const w = (window as any).api
    await waitFor(() => expect(w.cloudSession.createState).toHaveBeenCalledWith('s2'))
    expect(await screen.findByText(/never confirmed/)).toBeTruthy()
    expect(w.cloudSession.start).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Retry start' }))
    await waitFor(() => expect(w.cloudSession.start).toHaveBeenCalledTimes(1))
  })

  it('picks up a run still going in the main process when the tab remounts', async () => {
    const w = (window as any).api
    w.cloudSession.createState.mockResolvedValue(running)
    render(<Boot />)
    await waitFor(() => expect(screen.getByTestId('terminal').getAttribute('data-terminal')).toBe('term-c1'))
    expect(w.cloudSession.start).not.toHaveBeenCalled()
  })
})

describe('cloudCreatedPatch', () => {
  const base = { id: 's', name: 'n', branchName: 'session/n', worktreePath: '/w', projectId: 'p', createdAt: '' }
  const created = { sessionId: 's', projectId: 'p', terminalId: 't', status: 'created' as const, attached: false, result: { sessionId: 'session_01x', url: 'https://claude.ai/code/session_01x' } }

  it('turns pending into ready', () => {
    const patch = cloudCreatedPatch({ ...base, location: 'cloud', cloudPending: { task: 't', branch: 'session/n', createdAt: '' } }, created)
    expect(patch).toEqual({
      location: 'cloud',
      cloud: { sessionId: 'session_01x', url: 'https://claude.ai/code/session_01x', branch: 'session/n' },
      cloudPending: undefined,
    })
  })

  it('does nothing for runs that are not created, or sessions already bound', () => {
    expect(cloudCreatedPatch(base, { ...created, status: 'running' })).toBeNull()
    expect(cloudCreatedPatch({ ...base, cloud: { sessionId: 'session_other', url: 'u' } }, created)).toBeNull()
  })
})
