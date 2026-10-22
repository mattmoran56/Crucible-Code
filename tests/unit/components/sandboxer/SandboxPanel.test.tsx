import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SandboxPanel } from '../../../../src/renderer/components/sandboxer/SandboxPanel'
import { useProjectStore } from '../../../../src/renderer/stores/projectStore'
import { useSessionStore } from '../../../../src/renderer/stores/sessionStore'
import type { Project, SandboxInfo, Session } from '../../../../src/shared/types'

const session = {
  id: 's1',
  name: 'feat',
  branchName: 'session/feat',
  worktreePath: '/wt/feat',
  projectId: 'p1',
  createdAt: '2026-10-22T00:00:00Z',
} as Session

const running: SandboxInfo = {
  project: 'acme',
  slug: 'feat',
  branch: 'session/feat',
  worktree: '/wt/feat',
  state: 'running',
  container: 'sandboxer-acme-feat',
  urls: { app: 'https://feat--app--acme.sbx.localhost' },
}

let api: Record<string, ReturnType<typeof vi.fn>>

function setProject(project: Partial<Project>) {
  useProjectStore.setState({
    projects: [{ id: 'p1', name: 'Acme', repoPath: '/repo', ...project }],
    activeProjectId: 'p1',
  } as any)
}

beforeEach(() => {
  api = {
    status: vi.fn(async () => [running]),
    prepare: vi.fn(async () => ({ copied: true, source: '/repo/sandboxer.yaml' })),
    down: vi.fn(async () => ({ removed: ['acme/feat'], failed: [] })),
    stop: vi.fn(async () => {}),
    start: vi.fn(async () => {}),
    openUrl: vi.fn(async () => {}),
  }
  ;(window as any).api = {
    sandboxer: api,
    button: { execute: vi.fn(async () => 'term-1') },
  }
  useSessionStore.setState({ sessions: [session], activeSessionId: 's1' } as any)
  setProject({ sandboxer: { enabled: true, configPath: 'ops/sb.yaml' } })
})

describe('SandboxPanel', () => {
  it('does not poll sandboxer for a project that has it off', () => {
    setProject({})
    render(<SandboxPanel />)
    expect(screen.getByText(/Sandboxer is off for Acme/)).toBeInTheDocument()
    expect(api.status).not.toHaveBeenCalled()
  })

  it('shows the session sandbox state and opens its URLs', async () => {
    const user = userEvent.setup()
    render(<SandboxPanel />)
    await waitFor(() => expect(screen.getByText('acme/feat')).toBeInTheDocument())
    expect(api.status).toHaveBeenCalledWith('/wt/feat')
    expect(screen.getByText('running')).toBeInTheDocument()
    await user.click(screen.getByText('feat--app--acme.sbx.localhost'))
    expect(api.openUrl).toHaveBeenCalledWith('https://feat--app--acme.sbx.localhost')
  })

  it('starting a sandbox copies the config in, then runs sandboxer up in the worktree', async () => {
    api.status.mockResolvedValue([])
    const user = userEvent.setup()
    render(<SandboxPanel />)
    await user.click(await screen.findByRole('button', { name: 'Start sandbox' }))
    expect(api.prepare).toHaveBeenCalledWith('/repo', '/wt/feat', 'ops/sb.yaml')
    expect((window as any).api.button.execute).toHaveBeenCalledWith('sandboxer up', '/wt/feat', 'shell', 'terminal', 's1')
  })

  it('destroy asks first, then tears the sandbox down', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    render(<SandboxPanel />)
    await user.click(await screen.findByRole('button', { name: 'Destroy' }))
    expect(api.down).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Destroy' }))
    expect(api.down).toHaveBeenCalledWith('/wt/feat')
    confirm.mockRestore()
  })
})
