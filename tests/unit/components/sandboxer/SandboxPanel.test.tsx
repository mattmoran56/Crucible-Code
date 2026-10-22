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
  urls: {
    app: 'https://feat--app--acme.sbx.localhost',
    admin: 'https://feat--admin--acme.sbx.localhost',
    storybook: 'https://feat--storybook--acme.sbx.localhost',
  },
  links: { app: 'ready', admin: 'starting', storybook: 'not-built' },
}

const runningJob = {
  worktreePath: '/wt/feat',
  title: 'Starting sandbox',
  state: 'running' as const,
  lines: ['$ sandboxer up', '==> Building sandboxer/acme:f6eb'],
  step: 'Building sandboxer/acme:f6eb',
  startedAt: new Date().toISOString(),
}

let jobListener: ((job: any) => void) | null

let api: Record<string, ReturnType<typeof vi.fn>>

function setProject(project: Partial<Project>) {
  useProjectStore.setState({
    projects: [{ id: 'p1', name: 'Acme', repoPath: '/repo', ...project }],
    activeProjectId: 'p1',
  } as any)
}

beforeEach(() => {
  jobListener = null
  api = {
    status: vi.fn(async () => [running]),
    up: vi.fn(async () => runningJob),
    build: vi.fn(async () => ({ ...runningJob, title: 'Building storybook', step: null })),
    job: vi.fn(async () => null),
    cancelJob: vi.fn(async () => {}),
    onJobEvent: vi.fn((cb: (job: any) => void) => {
      jobListener = cb
      return () => {
        jobListener = null
      }
    }),
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

  it('marks each link ready, starting or not built, and counts the ready ones', async () => {
    render(<SandboxPanel />)
    expect(await screen.findByTestId('sandbox-ready-count')).toHaveTextContent('1 of 3 ready')
    const state = (text: string) => screen.getByText(text).closest('button')!.getAttribute('data-link-state')
    expect(state('feat--app--acme.sbx.localhost')).toBe('ready')
    expect(state('feat--admin--acme.sbx.localhost')).toBe('starting')
    expect(state('feat--storybook--acme.sbx.localhost')).toBe('not-built')
  })

  it('offers to build a front-end that is not built, as a job', async () => {
    const user = userEvent.setup()
    render(<SandboxPanel />)
    await user.click(await screen.findByRole('button', { name: 'Build' }))
    expect(api.build).toHaveBeenCalledWith(expect.objectContaining({ slug: 'feat' }), 'storybook')
    expect(await screen.findByText('Building storybook')).toBeInTheDocument()
  })

  it('starting a sandbox runs it as a job and shows its progress in the panel, not a terminal', async () => {
    api.status.mockResolvedValue([])
    const user = userEvent.setup()
    render(<SandboxPanel />)
    await user.click(await screen.findByRole('button', { name: 'Start sandbox' }))
    expect(api.up).toHaveBeenCalledWith('/repo', '/wt/feat', 'ops/sb.yaml')
    expect((window as any).api.button.execute).not.toHaveBeenCalled()
    expect(await screen.findByText('Starting sandbox')).toBeInTheDocument()
    expect(screen.getByText('Building sandboxer/acme:f6eb')).toBeInTheDocument()

    // Progress pushed from main updates the card; the output is there on demand.
    jobListener!({ ...runningJob, step: 'Starting session-feat from session/feat@99ec052', lines: [...runningJob.lines, '==> Starting session-feat'] })
    expect(await screen.findByText(/Starting session-feat from/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show output' }))
    expect(screen.getByText(/\$ sandboxer up/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(api.cancelJob).toHaveBeenCalledWith('/wt/feat')
  })

  it('shows a failed job with its output, and refreshes the sandbox when a job ends', async () => {
    render(<SandboxPanel />)
    await screen.findByText('acme/feat')
    const calls = api.status.mock.calls.length
    jobListener!({ ...runningJob, state: 'failed', exitCode: 1, finishedAt: new Date().toISOString(), lines: ['x boom'] })
    expect(await screen.findByText('Failed (exit 1)')).toBeInTheDocument()
    expect(screen.getByText('x boom')).toBeInTheDocument()
    await waitFor(() => expect(api.status.mock.calls.length).toBeGreaterThan(calls))
  })

  it('ignores job events for other worktrees, and picks up a job already running', async () => {
    api.job.mockResolvedValue(runningJob)
    render(<SandboxPanel />)
    expect(await screen.findByText('Starting sandbox')).toBeInTheDocument()
    jobListener!({ ...runningJob, worktreePath: '/wt/other', title: 'Elsewhere' })
    expect(screen.queryByText('Elsewhere')).not.toBeInTheDocument()
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
