import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SandboxerSettings } from '../../../../src/renderer/components/settings/SandboxerSettings'
import { useProjectStore } from '../../../../src/renderer/stores/projectStore'
import type { Project } from '../../../../src/shared/types'

const project: Project = { id: 'proj-a', name: 'Alpha', repoPath: '/repos/alpha' }

let updateProject: ReturnType<typeof vi.fn>
let checkConfig: ReturnType<typeof vi.fn>

beforeEach(() => {
  updateProject = vi.fn(async () => {})
  checkConfig = vi.fn(async () => ({
    path: '/repos/alpha/sandboxer.yaml',
    exists: true,
    gitState: 'ignored',
    cliVersion: '0.1.0',
  }))
  useProjectStore.setState({ updateProject } as any)
  ;(window as any).api = { sandboxer: { checkConfig } }
})

describe('SandboxerSettings', () => {
  it('is off by default and does not touch sandboxer', () => {
    render(<SandboxerSettings project={project} />)
    expect(screen.getByRole('radio', { name: 'Off' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByLabelText('Config file')).not.toBeInTheDocument()
    expect(checkConfig).not.toHaveBeenCalled()
  })

  it('turning it on saves enabled on the project', async () => {
    const user = userEvent.setup()
    render(<SandboxerSettings project={project} />)
    await user.click(screen.getByRole('radio', { name: 'On' }))
    expect(updateProject).toHaveBeenCalledWith({ ...project, sandboxer: { enabled: true } })
  })

  it('when on, shows where the config is and how git sees it', async () => {
    render(<SandboxerSettings project={{ ...project, sandboxer: { enabled: true } }} />)
    await waitFor(() => expect(screen.getByText('/repos/alpha/sandboxer.yaml')).toBeInTheDocument())
    expect(checkConfig).toHaveBeenCalledWith('/repos/alpha', undefined)
    expect(screen.getByText(/Kept out of git/)).toBeInTheDocument()
    expect(screen.getByText(/sandboxer 0.1.0 installed/)).toBeInTheDocument()
  })

  it('warns when the config or the CLI is missing', async () => {
    checkConfig.mockResolvedValueOnce({ path: '/repos/alpha/sandboxer.yaml', exists: false, gitState: 'unknown', cliVersion: null })
    render(<SandboxerSettings project={{ ...project, sandboxer: { enabled: true } }} />)
    await waitFor(() => expect(screen.getByText(/Not found/)).toBeInTheDocument())
    expect(screen.getByText(/not on PATH/)).toBeInTheDocument()
  })

  it('saves a custom config path on blur', async () => {
    const user = userEvent.setup()
    const enabled = { ...project, sandboxer: { enabled: true } }
    render(<SandboxerSettings project={enabled} />)
    await user.type(screen.getByLabelText('Config file'), 'ops/sandboxer.yaml')
    await user.tab()
    expect(updateProject).toHaveBeenCalledWith({
      ...project,
      sandboxer: { enabled: true, configPath: 'ops/sandboxer.yaml' },
    })
  })
})
