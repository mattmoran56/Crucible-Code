// Cloud sessions in the session workspace: the core Agent tab shows the cloud
// panel (attach terminal + Teleport) for cloud sessions, teleport refuses a
// dirty tree and otherwise switches the session local, and a session
// teleported in an earlier run resumes its discovered conversation as a
// visual agent.
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
import { saysAttachNotEnabled } from '../../../../src/renderer/components/cloud/CloudAgentHost'
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
  attach: vi.fn(async () => 'term-attach'),
  teleport: vi.fn(),
  discoverLocal: vi.fn(),
  send: vi.fn(async () => ({ sessionId: 'session_01abcdefgh', url: '' })),
  openUrl: vi.fn(async () => {}),
  create: vi.fn(),
}
const terminalSpawn = vi.fn(async () => 'term-x')
const save = vi.fn(async () => {})

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockClear()
  terminalSpawn.mockClear()
  save.mockClear()
  api.attach.mockResolvedValue('term-attach')
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
  useCloudSessionStore.setState({ teleports: {} })
  useWorkspaceLayoutStore.setState({ columns: [], savedLayouts: {} })
})

const panel = () => screen.queryByTestId('cloud-agent-panel')

describe('cloud session Agent tab', () => {
  it('shows the cloud panel and attaches `claude --cloud` instead of starting a visual agent', async () => {
    render(<SessionWorkspace />)
    expect(panel()).not.toBeNull()
    expect(screen.queryByTestId('visual-agent')).toBeNull()
    await waitFor(() => expect(screen.getByTestId('terminal').dataset.terminal).toBe('term-attach'))
    expect(api.attach).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 's1',
        worktreePath: '/wt/feat',
        cloudSessionId: 'session_01abcdefgh',
        configDir: '/cfg/work',
        repoPath: '/repo',
      })
    )
    expect(terminalSpawn).not.toHaveBeenCalled()
    expect(screen.getByText('Cloud')).toBeTruthy()
    expect(screen.getByText('01abcdef')).toBeTruthy()
  })

  it('opens the session URL in the browser', async () => {
    render(<SessionWorkspace />)
    fireEvent.click(screen.getByRole('button', { name: /Open in browser/ }))
    expect(api.openUrl).toHaveBeenCalledWith('https://claude.ai/code/session_01abcdefgh')
  })

  it('shows the error with Open in browser and a follow-up box when attaching is not enabled', async () => {
    render(<SessionWorkspace />)
    await waitFor(() => expect(screen.getByTestId('terminal')).toBeTruthy())
    act(() => {
      for (const cb of dataListeners) cb('term-attach', '\x1b[31mAttaching to an existing cloud session is not\r\n enabled for your account.\x1b[0m')
    })
    expect(screen.getByRole('alert').textContent).toMatch(/not enabled for your account/)
    fireEvent.change(screen.getByLabelText('Follow-up message'), { target: { value: 'add tests too' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() =>
      expect(api.send).toHaveBeenCalledWith({
        worktreePath: '/wt/feat',
        cloudSessionId: 'session_01abcdefgh',
        message: 'add tests too',
        configDir: '/cfg/work',
      })
    )
  })

  it('offers Reattach after the attach terminal exits', async () => {
    render(<SessionWorkspace />)
    await waitFor(() => expect(screen.getByTestId('terminal')).toBeTruthy())
    act(() => {
      for (const cb of exitListeners) cb('term-attach', 0)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Reattach' }))
    await waitFor(() => expect(api.attach).toHaveBeenCalledTimes(2))
  })

  it('teleport asks first, and refuses a dirty worktree without changing the session', async () => {
    api.teleport.mockResolvedValue({ ok: false, reason: 'dirty', files: ['src/a.ts', 'README.md'] })
    render(<SessionWorkspace />)
    await waitFor(() => expect(screen.getByTestId('terminal')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Teleport/ }))
    expect(screen.getByRole('group', { name: 'Confirm teleport' }).textContent).toMatch(
      /Bring this session down to your machine\? It will continue locally in \/wt\/feat/
    )
    expect(api.teleport).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Teleport' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/uncommitted changes.*src\/a\.ts, README\.md/))
    expect(useSessionStore.getState().sessions[0].location).toBe('cloud')
    expect(screen.getByTestId('terminal').dataset.terminal).toBe('term-attach')
    expect(save).not.toHaveBeenCalled()
  })

  it('teleport on a clean tree shows the teleport PTY and marks the session local', async () => {
    api.teleport.mockResolvedValue({ ok: true, terminalId: 'term-teleport' })
    render(<SessionWorkspace />)
    await waitFor(() => expect(screen.getByTestId('terminal')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Teleport/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Teleport' }))
    await waitFor(() => expect(screen.getByTestId('terminal').dataset.terminal).toBe('term-teleport'))
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
    fireEvent.click(screen.getByRole('button', { name: 'Continue as local agent' }))
    await waitFor(() => expect(screen.getByTestId('visual-agent').dataset.resume).toBe('local-claude-1'))
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
    expect(api.attach).not.toHaveBeenCalled()
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

describe('saysAttachNotEnabled', () => {
  it('ignores ANSI codes and line wrapping', () => {
    expect(saysAttachNotEnabled('\x1b[1mAttaching to an existing cloud\r\nsession is not enabled for your account.')).toBe(true)
    expect(saysAttachNotEnabled('Attached. Claude is working…')).toBe(false)
  })
})
