import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectVisibilitySettings } from '../../../../src/renderer/components/settings/ProjectVisibilitySettings'

const projects = [
  { id: 'a', name: 'alpha', repoPath: '/a' },
  { id: 'b', name: 'beta', repoPath: '/b', hidden: true },
  { id: 'c', name: 'gamma', repoPath: '/c' },
]

describe('ProjectVisibilitySettings', () => {
  it('lists hidden and shown projects separately', () => {
    render(<ProjectVisibilitySettings projects={projects} onSetHidden={vi.fn()} />)
    const hidden = screen.getByRole('region', { name: 'Hidden projects' })
    const shown = screen.getByRole('region', { name: 'Shown as tabs projects' })
    expect(within(hidden).getByText('beta')).toBeInTheDocument()
    expect(within(hidden).queryByText('alpha')).not.toBeInTheDocument()
    expect(within(shown).getByText('alpha')).toBeInTheDocument()
    expect(within(shown).getByText('gamma')).toBeInTheDocument()
  })

  it('unhides and hides projects', async () => {
    const user = userEvent.setup()
    const onSetHidden = vi.fn()
    render(<ProjectVisibilitySettings projects={projects} onSetHidden={onSetHidden} />)
    await user.click(screen.getByRole('button', { name: 'Unhide beta' }))
    expect(onSetHidden).toHaveBeenCalledWith('b', false)
    await user.click(screen.getByRole('button', { name: 'Hide gamma' }))
    expect(onSetHidden).toHaveBeenCalledWith('c', true)
  })

  it('explains how to hide when nothing is hidden', () => {
    render(<ProjectVisibilitySettings projects={projects.filter((p) => !p.hidden)} onSetHidden={vi.fn()} />)
    expect(screen.getByText(/Right-click a project tab/)).toBeInTheDocument()
  })
})
