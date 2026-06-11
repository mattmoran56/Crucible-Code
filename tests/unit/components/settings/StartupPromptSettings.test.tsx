import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StartupPromptSettings } from '../../../../src/renderer/components/settings/StartupPromptSettings'
import { useStartupPromptStore } from '../../../../src/renderer/stores/startupPromptStore'
import { useToastStore } from '../../../../src/renderer/stores/toastStore'
import type { Project, StartupPrompt } from '../../../../src/shared/types'

const projectA: Project = { id: 'proj-a', name: 'Alpha', repoPath: '/repos/alpha' }
const projectB: Project = { id: 'proj-b', name: 'Beta', repoPath: '/repos/beta' }

function makePrompt(overrides: Partial<StartupPrompt> = {}): StartupPrompt {
  return {
    id: `sp-${Math.random().toString(36).slice(2)}`,
    label: 'Run lint',
    command: 'npm run lint',
    order: 0,
    ...overrides,
  }
}

let listMock: ReturnType<typeof vi.fn>
let saveMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  listMock = vi.fn(async () => [] as StartupPrompt[])
  saveMock = vi.fn(async () => {})
  ;(window as any).api = {
    startupPrompt: { list: listMock, save: saveMock },
  }
  useStartupPromptStore.setState({ byProject: {}, loadingProjects: new Set() })
  useToastStore.setState({ toasts: [] })
})

// Seed both the store and the list() mock — the component re-loads each
// project's prompts on mount, which would otherwise wipe pre-set state.
function seedPrompts(projectId: string, prompts: StartupPrompt[]) {
  useStartupPromptStore.setState({ byProject: { [projectId]: prompts } })
  listMock.mockImplementation(async (pid: string) => (pid === projectId ? prompts : []))
}

// userEvent treats "{{" as keyboard-escape syntax, so set brace-heavy
// command values via a change event instead.
function setValue(el: HTMLElement, value: string) {
  fireEvent.change(el, { target: { value } })
}

describe('StartupPromptSettings', () => {
  it('renders nothing when there are no projects', () => {
    const { container } = render(<StartupPromptSettings projects={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the section heading and helper copy', () => {
    render(<StartupPromptSettings projects={[projectA]} />)
    expect(screen.getByRole('heading', { name: 'Session Startup Prompts' })).toBeInTheDocument()
    expect(screen.getByText(/auto-run in a new session's agent terminal/)).toBeInTheDocument()
  })

  it('renders one card per project with name and repo path', () => {
    render(<StartupPromptSettings projects={[projectA, projectB]} />)
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('/repos/alpha')).toBeInTheDocument()
    expect(screen.getByText('Beta')).toBeInTheDocument()
    expect(screen.getByText('/repos/beta')).toBeInTheDocument()
  })

  it('loads prompts for every project on mount', async () => {
    render(<StartupPromptSettings projects={[projectA, projectB]} />)
    await waitFor(() => {
      expect(listMock).toHaveBeenCalledWith('proj-a')
      expect(listMock).toHaveBeenCalledWith('proj-b')
    })
  })

  it('renders prompt rows with label and command from the store', () => {
    seedPrompts('proj-a', [makePrompt({ label: 'Ticket', command: '/ticket 42' })])
    render(<StartupPromptSettings projects={[projectA]} />)
    expect(screen.getByText('Ticket')).toBeInTheDocument()
    expect(screen.getByText('/ticket 42')).toBeInTheDocument()
  })

  it('shows the "needs input" badge for commands containing {{input}}', () => {
    seedPrompts('proj-a', [makePrompt({ command: '/notion-ticket {{input}}' })])
    render(<StartupPromptSettings projects={[projectA]} />)
    expect(screen.getByText('needs input')).toBeInTheDocument()
  })

  it('omits the "needs input" badge for plain commands', () => {
    seedPrompts('proj-a', [makePrompt({ command: 'npm test' })])
    render(<StartupPromptSettings projects={[projectA]} />)
    expect(screen.queryByText('needs input')).not.toBeInTheDocument()
  })

  it('opens the Add prompt dialog from the card button', async () => {
    const user = userEvent.setup()
    render(<StartupPromptSettings projects={[projectA]} />)
    await user.click(screen.getByRole('button', { name: '+ Add prompt' }))
    expect(screen.getByRole('dialog', { name: 'Add prompt' })).toBeInTheDocument()
  })

  it('disables Create until both label and command are filled', async () => {
    const user = userEvent.setup()
    render(<StartupPromptSettings projects={[projectA]} />)
    await user.click(screen.getByRole('button', { name: '+ Add prompt' }))
    const dialog = screen.getByRole('dialog')
    const create = within(dialog).getByRole('button', { name: 'Create' })
    expect(create).toBeDisabled()

    await user.type(within(dialog).getByLabelText('Label'), 'My prompt')
    expect(create).toBeDisabled()

    await user.type(within(dialog).getByPlaceholderText('/notion-ticket {{input}}'), 'npm test')
    expect(create).toBeEnabled()
  })

  it('creating a prompt persists it via window.api and closes the dialog', async () => {
    const user = userEvent.setup()
    render(<StartupPromptSettings projects={[projectA]} />)
    await user.click(screen.getByRole('button', { name: '+ Add prompt' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText('Label'), '  Lint  ')
    await user.type(within(dialog).getByPlaceholderText('/notion-ticket {{input}}'), 'npm run lint')
    await user.click(within(dialog).getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1))
    const [projectId, prompts] = saveMock.mock.calls[0]
    expect(projectId).toBe('proj-a')
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toMatchObject({ label: 'Lint', command: 'npm run lint', order: 0 })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('updates the store so the new prompt row renders after create', async () => {
    const user = userEvent.setup()
    render(<StartupPromptSettings projects={[projectA]} />)
    await user.click(screen.getByRole('button', { name: '+ Add prompt' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText('Label'), 'Deploy')
    await user.type(within(dialog).getByPlaceholderText('/notion-ticket {{input}}'), './deploy.sh')
    await user.click(within(dialog).getByRole('button', { name: 'Create' }))

    expect(await screen.findByText('Deploy')).toBeInTheDocument()
    expect(useStartupPromptStore.getState().byProject['proj-a']).toHaveLength(1)
  })

  it('reveals input label/placeholder fields when the command contains {{input}}', async () => {
    const user = userEvent.setup()
    render(<StartupPromptSettings projects={[projectA]} />)
    await user.click(screen.getByRole('button', { name: '+ Add prompt' }))
    const dialog = screen.getByRole('dialog')

    expect(within(dialog).queryByLabelText('Input field label')).not.toBeInTheDocument()
    setValue(within(dialog).getByPlaceholderText('/notion-ticket {{input}}'), '/cmd {{input}}')
    expect(within(dialog).getByLabelText('Input field label')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Input placeholder (optional)')).toBeInTheDocument()
  })

  it('persists inputLabel and inputPlaceholder for {{input}} commands', async () => {
    const user = userEvent.setup()
    render(<StartupPromptSettings projects={[projectA]} />)
    await user.click(screen.getByRole('button', { name: '+ Add prompt' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText('Label'), 'Ticket')
    setValue(within(dialog).getByPlaceholderText('/notion-ticket {{input}}'), '/t {{input}}')
    await user.type(within(dialog).getByLabelText('Input field label'), 'Ticket URL')
    await user.type(within(dialog).getByLabelText('Input placeholder (optional)'), 'https://…')
    await user.click(within(dialog).getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(saveMock).toHaveBeenCalled())
    const [, prompts] = saveMock.mock.calls[0]
    expect(prompts[0]).toMatchObject({
      inputLabel: 'Ticket URL',
      inputPlaceholder: 'https://…',
    })
  })

  it('drops inputLabel when the command has no {{input}} token', async () => {
    const user = userEvent.setup()
    render(<StartupPromptSettings projects={[projectA]} />)
    await user.click(screen.getByRole('button', { name: '+ Add prompt' }))
    const dialog = screen.getByRole('dialog')
    const commandBox = within(dialog).getByPlaceholderText('/notion-ticket {{input}}')
    await user.type(within(dialog).getByLabelText('Label'), 'X')
    setValue(commandBox, '/x {{input}}')
    await user.type(within(dialog).getByLabelText('Input field label'), 'Some label')
    // Remove the {{input}} token again — the saved prompt must not keep inputLabel.
    setValue(commandBox, '/x plain')
    await user.click(within(dialog).getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(saveMock).toHaveBeenCalled())
    const [, prompts] = saveMock.mock.calls[0]
    expect(prompts[0].inputLabel).toBeUndefined()
    expect(prompts[0].inputPlaceholder).toBeUndefined()
  })

  it('Cancel closes the dialog without saving', async () => {
    const user = userEvent.setup()
    render(<StartupPromptSettings projects={[projectA]} />)
    await user.click(screen.getByRole('button', { name: '+ Add prompt' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText('Label'), 'Throwaway')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(saveMock).not.toHaveBeenCalled()
  })

  it('Edit opens the dialog prefilled with the prompt values', async () => {
    const user = userEvent.setup()
    seedPrompts('proj-a', [makePrompt({ id: 'sp-1', label: 'Old label', command: 'old-cmd' })])
    render(<StartupPromptSettings projects={[projectA]} />)
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit prompt' })
    expect(within(dialog).getByLabelText('Label')).toHaveValue('Old label')
    expect(within(dialog).getByPlaceholderText('/notion-ticket {{input}}')).toHaveValue('old-cmd')
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })

  it('saving an edit keeps the id and order but applies new values', async () => {
    const user = userEvent.setup()
    seedPrompts('proj-a', [
      makePrompt({ id: 'sp-1', label: 'Old label', command: 'old-cmd', order: 3 }),
    ])
    render(<StartupPromptSettings projects={[projectA]} />)
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const dialog = screen.getByRole('dialog')
    const label = within(dialog).getByLabelText('Label')
    await user.clear(label)
    await user.type(label, 'New label')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(saveMock).toHaveBeenCalled())
    const [, prompts] = saveMock.mock.calls[0]
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toMatchObject({ id: 'sp-1', label: 'New label', command: 'old-cmd', order: 3 })
  })

  it('Delete removes the prompt and persists the remaining list', async () => {
    const user = userEvent.setup()
    seedPrompts('proj-a', [
      makePrompt({ id: 'sp-1', label: 'Keep me', order: 0 }),
      makePrompt({ id: 'sp-2', label: 'Delete me', order: 1 }),
    ])
    render(<StartupPromptSettings projects={[projectA]} />)
    const row = screen.getByText('Delete me').closest('.group') as HTMLElement
    await user.click(within(row).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(saveMock).toHaveBeenCalled())
    const [, prompts] = saveMock.mock.calls[0]
    expect(prompts.map((p: StartupPrompt) => p.id)).toEqual(['sp-1'])
    expect(screen.queryByText('Delete me')).not.toBeInTheDocument()
  })

  it('new prompts get order equal to the current list length', async () => {
    const user = userEvent.setup()
    seedPrompts('proj-a', [
      makePrompt({ id: 'sp-1', order: 0 }),
      makePrompt({ id: 'sp-2', order: 1 }),
    ])
    render(<StartupPromptSettings projects={[projectA]} />)
    await user.click(screen.getByRole('button', { name: '+ Add prompt' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText('Label'), 'Third')
    await user.type(within(dialog).getByPlaceholderText('/notion-ticket {{input}}'), 'cmd3')
    await user.click(within(dialog).getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(saveMock).toHaveBeenCalled())
    const [, prompts] = saveMock.mock.calls[0]
    const third = prompts.find((p: StartupPrompt) => p.label === 'Third')
    expect(third.order).toBe(2)
  })
})
