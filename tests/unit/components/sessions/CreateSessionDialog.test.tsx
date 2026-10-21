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
      location: 'cloud',
      configDir: '/cfg/work',
    })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('switching to Local keeps today’s local create', async () => {
    render(<CreateSessionDialog open project={project()} onClose={() => {}} />)
    await waitFor(() => expect((window as any).api.git.defaultBranch).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText('Session name'), { target: { value: 'fix-auth' } })
    fireEvent.click(radio('Local'))
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(createSession).toHaveBeenCalledWith('p1', '/repo', 'fix-auth', 'main', undefined, undefined, undefined))
  })

  it('hides the toggle for scheduled sessions (they start locally)', () => {
    render(<CreateSessionDialog open project={project()} onClose={() => {}} />)
    fireEvent.click(screen.getByLabelText('Schedule for later'))
    expect(screen.queryByRole('radio', { name: 'Cloud' })).toBeNull()
    expect(screen.queryByLabelText('Task')).toBeNull()
  })
})
