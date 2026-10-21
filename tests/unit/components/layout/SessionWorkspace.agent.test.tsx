// The session workspace's agent tabs are always visual agents: the core Agent
// tab and every dynamic agent tab (including legacy `visual-agent:N` ones)
// mount a VisualAgentPanel, with no per-project gate, and never spawn a
// claude PTY.
import React from 'react'
import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VisualAgentStartOptions } from '../../../../src/shared/visual-agent'

vi.mock('../../../../src/renderer/components/visual-agent/VisualAgentPanel', () => ({
  VisualAgentPanel: ({ agentId, startOptions, visible }: { agentId: string; startOptions: VisualAgentStartOptions; visible: boolean }) => (
    <div data-testid="visual-agent" data-agent={agentId} data-prompt={startOptions.initialPrompt ?? ''} data-resume={startOptions.resumeClaudeSessionId ?? ''} data-visible={String(visible)} />
  ),
}))
vi.mock('../../../../src/renderer/components/terminal/DynamicTerminalPanel', () => ({
  DynamicTerminalPanel: ({ tabId }: { tabId: string }) => <div data-testid="dynamic-terminal" data-tab={tabId} />,
}))
vi.mock('../../../../src/renderer/components/terminal/ReviewTerminalPanel', () => ({ ReviewTerminalPanel: () => null }))
vi.mock('../../../../src/renderer/components/review-loop/ReviewLoopPanel', () => ({ ReviewLoopPanel: () => null }))
vi.mock('../../../../src/renderer/components/git/GitPanel', () => ({ GitPanel: () => null }))
vi.mock('../../../../src/renderer/components/pullrequests/PRReviewPanel', () => ({ PRReviewPanel: () => null }))
// A bare column: just the content slot the workspace portals its panels into.
vi.mock('../../../../src/renderer/components/layout/WorkspaceColumn', () => ({
  ColumnPanel: ({ column }: { column: { id: string } }) => (
    <div data-column-id={column.id}>
      <div data-column-content />
    </div>
  ),
}))

import { SessionWorkspace } from '../../../../src/renderer/components/layout/SessionWorkspace'
import { useSessionStore } from '../../../../src/renderer/stores/sessionStore'
import { useProjectStore } from '../../../../src/renderer/stores/projectStore'
import { useWorkspaceLayoutStore, type WorkspaceTab } from '../../../../src/renderer/stores/workspaceLayoutStore'

const terminalSpawn = vi.fn(async () => 'term-1')

const session = {
  id: 's1',
  name: 'feat',
  branchName: 'session/feat',
  worktreePath: '/wt/feat',
  projectId: 'p1',
  createdAt: '2026-10-21T00:00:00Z',
}

beforeEach(() => {
  terminalSpawn.mockClear()
  ;(window as any).api = {
    terminal: { spawn: terminalSpawn, write: vi.fn(), onData: vi.fn(() => () => {}), onExit: vi.fn(() => () => {}) },
    session: { save: vi.fn(async () => {}) },
  }
  // A project with no visual-agent setting at all.
  useProjectStore.setState({ projects: [{ id: 'p1', name: 'acme', repoPath: '/repo' }], activeProjectId: 'p1', claudeAccounts: [] } as any)
  useSessionStore.setState({
    sessions: [session],
    currentProjectId: 'p1',
    activeSessionId: 's1',
    activePRNumber: null,
    openedAsMainBranch: null,
    didStash: false,
    pendingStartup: { sessionId: 's1', command: 'fix the bug' },
  } as any)
  useWorkspaceLayoutStore.setState({ columns: [], savedLayouts: {} })
})

const agents = () => screen.queryAllByTestId('visual-agent')

describe('<SessionWorkspace> agent tabs', () => {
  it('renders the core Agent tab as a VisualAgentPanel with the startup prompt, without spawning a PTY', () => {
    render(<SessionWorkspace />)
    const panel = agents().find((el) => el.dataset.agent === 's1:agent')
    expect(panel).toBeDefined()
    expect(panel!.dataset.prompt).toBe('fix the bug')
    expect(panel!.dataset.visible).toBe('true')
    expect(useSessionStore.getState().pendingStartup).toBeNull()
    expect(terminalSpawn).not.toHaveBeenCalled()
  })

  it('renders a "New Agent" tab as a visual agent, and "New Terminal" as a terminal', () => {
    render(<SessionWorkspace />)
    const columnId = useWorkspaceLayoutStore.getState().columns[0].id
    let agentTab: WorkspaceTab
    let terminalTab: WorkspaceTab
    act(() => {
      agentTab = useWorkspaceLayoutStore.getState().addDynamicTab(columnId, 'agent')
    })
    expect(agentTab!).toMatch(/^agent:\d+$/)
    expect(agents().map((el) => el.dataset.agent)).toContain(`s1:${agentTab!}`)
    act(() => {
      terminalTab = useWorkspaceLayoutStore.getState().addDynamicTab(columnId, 'terminal')
    })
    expect(screen.getByTestId('dynamic-terminal').dataset.tab).toBe(terminalTab!)
    expect(agents().map((el) => el.dataset.agent)).not.toContain(`s1:${terminalTab!}`)
  })

  it('renders agent:N and legacy visual-agent:N tabs from a saved layout as visual agents', () => {
    useWorkspaceLayoutStore.setState({
      savedLayouts: {
        s1: [
          {
            id: 'c9',
            tabs: ['agent', 'agent:3', 'visual-agent:2', 'git'] as WorkspaceTab[],
            activeTab: 'agent:3' as WorkspaceTab,
            flex: 1,
          },
        ],
      },
    })
    render(<SessionWorkspace />)
    const ids = agents().map((el) => el.dataset.agent).sort()
    expect(ids).toEqual(['s1:agent', 's1:agent:3', 's1:visual-agent:2'])
    expect(agents().find((el) => el.dataset.agent === 's1:agent:3')!.dataset.visible).toBe('true')
    expect(screen.queryByTestId('dynamic-terminal')).toBeNull()
    expect(terminalSpawn).not.toHaveBeenCalled()
  })

  it('resumes each agent tab on the conversation saved under its own tab key', () => {
    useSessionStore.setState({
      sessions: [
        {
          ...session,
          visualAgents: {
            agent: { claudeSessionId: 'cs-core', model: 'claude-opus-5-5' },
            'agent:3': { claudeSessionId: 'cs-three', model: 'claude-opus-5-5' },
          },
        },
      ],
    } as any)
    useWorkspaceLayoutStore.setState({
      savedLayouts: { s1: [{ id: 'c9', tabs: ['agent', 'agent:3'] as WorkspaceTab[], activeTab: 'agent' as WorkspaceTab, flex: 1 }] },
    })
    render(<SessionWorkspace />)
    const resume = Object.fromEntries(agents().map((el) => [el.dataset.agent, el.dataset.resume]))
    expect(resume).toEqual({ 's1:agent': 'cs-core', 's1:agent:3': 'cs-three' })
  })
})
