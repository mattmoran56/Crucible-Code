import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SessionLocationSetting } from '../../../../src/renderer/components/settings/SessionLocationSetting'
import { useProjectStore } from '../../../../src/renderer/stores/projectStore'
import type { Project } from '../../../../src/shared/types'

const project: Project = { id: 'proj-a', name: 'Alpha', repoPath: '/repos/alpha' }

let updateProject: ReturnType<typeof vi.fn>

beforeEach(() => {
  updateProject = vi.fn(async () => {})
  useProjectStore.setState({ updateProject } as any)
})

describe('SessionLocationSetting', () => {
  it('defaults to Cloud when the project has no defaultSessionLocation', () => {
    render(<SessionLocationSetting project={project} />)
    expect(screen.getByText('Default session location')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Cloud' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Local' })).toHaveAttribute('aria-checked', 'false')
  })

  it('explains the cloud requirements', () => {
    render(<SessionLocationSetting project={project} />)
    expect(screen.getByText(/Claude GitHub App installed/)).toBeInTheDocument()
    expect(screen.getByText(/teleported down to the\s+local worktree/)).toBeInTheDocument()
  })

  it('selecting Local saves defaultSessionLocation "local" on the project', async () => {
    const user = userEvent.setup()
    render(<SessionLocationSetting project={project} />)
    await user.click(screen.getByRole('radio', { name: 'Local' }))
    expect(updateProject).toHaveBeenCalledWith({ ...project, defaultSessionLocation: 'local' })
  })

  it('reflects a stored Local preference and can switch back to Cloud', async () => {
    const user = userEvent.setup()
    const localProject: Project = { ...project, defaultSessionLocation: 'local' }
    render(<SessionLocationSetting project={localProject} />)
    expect(screen.getByRole('radio', { name: 'Local' })).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByRole('radio', { name: 'Cloud' }))
    expect(updateProject).toHaveBeenCalledWith({ ...project, defaultSessionLocation: 'cloud' })
  })

  it('clicking the already-selected option does not save', async () => {
    const user = userEvent.setup()
    render(<SessionLocationSetting project={project} />)
    await user.click(screen.getByRole('radio', { name: 'Cloud' }))
    expect(updateProject).not.toHaveBeenCalled()
  })
})
