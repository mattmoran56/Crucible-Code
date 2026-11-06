import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CreateSessionDialog } from '../../../../src/renderer/components/sessions/CreateSessionDialog'
import { useSessionStore } from '../../../../src/renderer/stores/sessionStore'
import { useProjectStore } from '../../../../src/renderer/stores/projectStore'
import { useStartupPromptStore } from '../../../../src/renderer/stores/startupPromptStore'
import type { Project } from '../../../../src/shared/types'

const createSession = vi.fn(async () => {})

beforeEach(() => {
  createSession.mockClear()
  ;(window as any).api = {
    git: { defaultBranch: vi.fn(async () => 'main'), listBranches: vi.fn(async () => ['main']) },
    startupPrompt: { list: vi.fn(async () => []), save: vi.fn() },
  }
  useSessionStore.setState({ createSession } as any)
  useProjectStore.setState({ claudeAccounts: [{ id: 'a1', name: 'Work', configDir: '/cfg/work' }] } as any)
  useStartupPromptStore.setState({ byProject: {} } as any)
})

const project = (extra: Partial<Project> = {}): Project => ({ id: 'p1', name: 'acme', repoPath: '/repo', ...extra })
const radio = (name: string) => screen.getByRole('radio', { name })

describe('<CreateSessionDialog> location toggle', () => {
  it('defaults to Cloud when the project has no preference', async () => {
    render(<CreateSessionDialog open project={project()} onClose={() => {}} />)
    expect(radio('Cloud').getAttribute('aria-checked')).toBe('true')
    expect(radio('Local').getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('button', { name: 'Start in cloud' })).toBeTruthy()
  })

  it('defaults to Local when the project opted out', () => {
    render(<CreateSessionDialog open project={project({ defaultSessionLocation: 'local' })} onClose={() => {}} />)
    expect(radio('Local').getAttribute('aria-checked')).toBe('true')
    expect(screen.queryByLabelText('Task')).toBeNull()
    expect(screen.getByRole('button', { name: 'Create' })).toBeTruthy()
  })

  it('needs a task for a cloud session, then creates it in the cloud with the account config dir', async () => {
    const onClose = vi.fn()
    render(<CreateSessionDialog open project={project({ claudeAccountId: 'a1' })} onClose={onClose} />)
    await waitFor(() => expect((window as any).api.git.defaultBranch).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText('Session name'), { target: { value: 'fix-auth' } })
    const submit = screen.getByRole('button', { name: 'Start in cloud' }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Task'), { target: { value: 'Fix the auth bug' } })
    expect(submit.disabled).toBe(false)
    fireEvent.click(submit)
    await waitFor(() => expect(createSession).toHaveBeenCalled())
    expect(createSession).toHaveBeenCalledWith('p1', '/repo', 'fix-auth', 'main', 'Fix the auth bug', undefined, {
      branchName: undefined,
      autoBranch: true,
      mode: 'single-branch',
      location: 'cloud',
    })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('offers an orchestrator cloud session and passes the mode through', async () => {
    render(<CreateSessionDialog open project={project()} onClose={() => {}} />)
    await waitFor(() => expect((window as any).api.git.defaultBranch).toHaveBeenCalled())
    expect(radio('Single branch').getAttribute('aria-checked')).toBe('true')
    fireEvent.change(screen.getByLabelText('Session name'), { target: { value: 'Big Refactor' } })
    fireEvent.click(radio('Orchestrator'))
    fireEvent.change(screen.getByLabelText('Task'), { target: { value: 'Split it up' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start in cloud' }))
    await waitFor(() =>
      expect(createSession).toHaveBeenCalledWith('p1', '/repo', 'Big Refactor', 'main', 'Split it up', undefined, {
        branchName: undefined,
        autoBranch: true,
        mode: 'orchestrator',
        location: 'cloud',
      })
    )
  })

  it('offers an orchestrator local session and passes the mode through', async () => {
    render(<CreateSessionDialog open project={project({ defaultSessionLocation: 'local' })} onClose={() => {}} />)
    await waitFor(() => expect((window as any).api.git.defaultBranch).toHaveBeenCalled())
    expect(radio('Single branch').getAttribute('aria-checked')).toBe('true')
    fireEvent.change(screen.getByLabelText('Session name'), { target: { value: 'Big Refactor' } })
    fireEvent.click(radio('Orchestrator'))
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() =>
      expect(createSession).toHaveBeenCalledWith('p1', '/repo', 'Big Refactor', 'main', undefined, undefined, {
        branchName: undefined,
        autoBranch: true,
        mode: 'orchestrator',
      })
    )
  })

  it('hides the session type for scheduled sessions', () => {
    render(<CreateSessionDialog open project={project({ defaultSessionLocation: 'local' })} onClose={() => {}} />)
    fireEvent.click(screen.getByLabelText('Schedule for later'))
    expect(screen.queryByRole('radio', { name: 'Orchestrator' })).toBeNull()
  })

  it('switching to Local keeps today’s local create', async () => {
    render(<CreateSessionDialog open project={project()} onClose={() => {}} />)
    await waitFor(() => expect((window as any).api.git.defaultBranch).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText('Session name'), { target: { value: 'fix-auth' } })
    fireEvent.click(radio('Local'))
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() =>
      expect(createSession).toHaveBeenCalledWith('p1', '/repo', 'fix-auth', 'main', undefined, undefined, {
        branchName: undefined,
        autoBranch: true,
        mode: 'single-branch',
      })
    )
  })

  it('hides the toggle for scheduled sessions (they start locally)', () => {
    render(<CreateSessionDialog open project={project()} onClose={() => {}} />)
    fireEvent.click(screen.getByLabelText('Schedule for later'))
    expect(screen.queryByRole('radio', { name: 'Cloud' })).toBeNull()
    expect(screen.queryByLabelText('Task')).toBeNull()
  })
})

describe('<CreateSessionDialog> blank name and branch', () => {
  it('creates with both blank, to be named from the first message', async () => {
    render(<CreateSessionDialog open project={project({ defaultSessionLocation: 'local' })} onClose={() => {}} />)
    await waitFor(() => expect((window as any).api.git.defaultBranch).toHaveBeenCalled())
    expect(screen.getByTestId('auto-naming-hint').textContent).toBe('The name and branch will be picked from your first message.')
    const submit = screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement
    expect(submit.disabled).toBe(false)
    fireEvent.click(submit)
    await waitFor(() =>
      expect(createSession).toHaveBeenCalledWith('p1', '/repo', '', 'main', undefined, undefined, {
        branchName: undefined,
        autoBranch: true,
        mode: 'single-branch',
      })
    )
  })

  it('says a cloud task names them', async () => {
    render(<CreateSessionDialog open project={project()} onClose={() => {}} />)
    await waitFor(() => expect((window as any).api.git.defaultBranch).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText('Task'), { target: { value: 'Fix the auth bug' } })
    expect(screen.getByTestId('auto-naming-hint').textContent).toBe('The name and branch will be picked from the startup prompt.')
  })

  it('still needs a name to schedule', () => {
    render(<CreateSessionDialog open project={project({ defaultSessionLocation: 'local' })} onClose={() => {}} />)
    fireEvent.click(screen.getByLabelText('Schedule for later'))
    expect((screen.getByRole('button', { name: 'Schedule' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('<CreateSessionDialog> branch field', () => {
  const branchInput = () => screen.getByLabelText('Branch') as HTMLInputElement

  it('stays blank (named from the first prompt) and passes a typed branch through', async () => {
    render(<CreateSessionDialog open project={project({ defaultSessionLocation: 'local' })} onClose={() => {}} />)
    await waitFor(() => expect((window as any).api.git.defaultBranch).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText('Session name'), { target: { value: 'login' } })
    expect(branchInput().value).toBe('')
    expect(screen.getByTestId('auto-naming-hint').textContent).toBe('The branch will be picked from your first message.')
    fireEvent.change(branchInput(), { target: { value: 'feature/login' } })
    expect(screen.queryByTestId('auto-naming-hint')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() =>
      expect(createSession).toHaveBeenCalledWith('p1', '/repo', 'login', 'main', undefined, undefined, {
        branchName: 'feature/login',
        autoBranch: false,
        mode: 'single-branch',
      })
    )
  })

  it('shows an inline error and blocks submit for an invalid branch', async () => {
    render(<CreateSessionDialog open project={project({ defaultSessionLocation: 'local' })} onClose={() => {}} />)
    await waitFor(() => expect((window as any).api.git.defaultBranch).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText('Session name'), { target: { value: 'x' } })
    fireEvent.change(branchInput(), { target: { value: 'bad name' } })
    expect(screen.getByText('Branch name cannot contain spaces')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('refuses an existing branch', async () => {
    render(<CreateSessionDialog open project={project({ defaultSessionLocation: 'local' })} onClose={() => {}} />)
    await waitFor(() => expect((window as any).api.git.defaultBranch).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText('Session name'), { target: { value: 'x' } })
    fireEvent.change(branchInput(), { target: { value: 'main' } })
    await waitFor(() => expect(screen.getByText('A branch named main already exists')).toBeTruthy())
  })

  it('refuses the base branch for a cloud session', async () => {
    ;(window as any).api.git.defaultBranch = vi.fn(async () => 'develop')
    render(<CreateSessionDialog open project={project()} onClose={() => {}} />)
    await waitFor(() => expect((window as any).api.git.defaultBranch).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText('Session name'), { target: { value: 'x' } })
    fireEvent.change(branchInput(), { target: { value: 'develop' } })
    await waitFor(() => expect(screen.getByText('A cloud session needs its own branch, not the base branch')).toBeTruthy())
  })

  it('is hidden for scheduled sessions', () => {
    render(<CreateSessionDialog open project={project()} onClose={() => {}} />)
    fireEvent.click(screen.getByLabelText('Schedule for later'))
    expect(screen.queryByLabelText('Branch')).toBeNull()
  })
})
