// Agent tabs in the Code workspace are visual agents too: they run in the
// repo root and report status against the Code editor's context, and never
// spawn a claude PTY. Terminal tabs stay terminals.
import React from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VisualAgentStartOptions } from '../../../../src/shared/visual-agent'

vi.mock('../../../../src/renderer/components/visual-agent/VisualAgentPanel', () => ({
  VisualAgentPanel: ({ agentId, startOptions, visible }: { agentId: string; startOptions: VisualAgentStartOptions; visible: boolean }) => (
    <div
      data-testid="visual-agent"
      data-agent={agentId}
      data-session={startOptions.sessionId}
      data-cwd={startOptions.cwd}
      data-visible={String(visible)}
    />
  ),
}))
vi.mock('../../../../src/renderer/components/terminal/DynamicTerminalPanel', () => ({
  DynamicTerminalPanel: ({ tabId }: { tabId: string }) => <div data-testid="dynamic-terminal" data-tab={tabId} />,
}))
vi.mock('../../../../src/renderer/components/editor/EditorPanel', () => ({ EditorPanel: () => null }))
vi.mock('../../../../src/renderer/components/git/GitPanelView', () => ({ GitPanelView: () => null }))
vi.mock('../../../../src/renderer/components/layout/WorkspaceColumn', () => ({
  ColumnPanel: ({ column }: { column: { id: string } }) => (
    <div data-column-id={column.id}>
      <div data-column-content />
    </div>
  ),
}))

import { EditorWorkspace } from '../../../../src/renderer/components/editor/EditorWorkspace'
import { useProjectStore } from '../../../../src/renderer/stores/projectStore'
import { useEditorStore } from '../../../../src/renderer/stores/editorStore'
import { useWorkspaceLayoutStore, type WorkspaceTab } from '../../../../src/renderer/stores/workspaceLayoutStore'

beforeEach(() => {
  ;(window as any).api = {
    notification: { registerSession: vi.fn(async () => {}) },
    terminal: { spawn: vi.fn(async () => 'term-1') },
  }
  useEditorStore.setState({ loadBranch: vi.fn(async () => {}) } as any)
  useProjectStore.setState({ projects: [{ id: 'p1', name: 'acme', repoPath: '/repo' }], activeProjectId: 'p1', claudeAccounts: [] } as any)
  useWorkspaceLayoutStore.setState({
    columns: [],
    savedLayouts: {
      'code-editor:p1': [
        { id: 'c1', tabs: ['code', 'git', 'agent:2', 'terminal:1'] as WorkspaceTab[], activeTab: 'agent:2' as WorkspaceTab, flex: 1 },
      ],
    },
  })
})

describe('<EditorWorkspace> agent tabs', () => {
  it('renders agent:N as a visual agent in the repo root and terminal:N as a terminal', () => {
    render(<EditorWorkspace />)
    const agent = screen.getByTestId('visual-agent')
    expect(agent.dataset.agent).toBe('code-editor:p1:agent:2')
    expect(agent.dataset.session).toBe('code-editor:p1')
    expect(agent.dataset.cwd).toBe('/repo')
    expect(agent.dataset.visible).toBe('true')
    expect(screen.getByTestId('dynamic-terminal').dataset.tab).toBe('terminal:1')
    expect((window as any).api.terminal.spawn).not.toHaveBeenCalled()
  })
})
