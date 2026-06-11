import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ButtonSettings } from '../../../../src/renderer/components/settings/ButtonSettings'
import { useButtonStore } from '../../../../src/renderer/stores/buttonStore'
import { useProjectStore } from '../../../../src/renderer/stores/projectStore'
import { useToastStore } from '../../../../src/renderer/stores/toastStore'
import type { CustomButton, CustomButtonGroup } from '../../../../src/shared/types'

function makeButton(overrides: Partial<CustomButton> = {}): CustomButton {
  return {
    id: `btn-${Math.random().toString(36).slice(2)}`,
    label: 'Run Tests',
    icon: 'Play',
    placement: 'session-toolbar',
    actionType: 'shell',
    executionMode: 'background',
    command: 'npm test',
    scope: { type: 'global' },
    order: 0,
    ...overrides,
  }
}

function makeGroup(overrides: Partial<CustomButtonGroup> = {}): CustomButtonGroup {
  return {
    id: `grp-${Math.random().toString(36).slice(2)}`,
    label: 'Deploy Actions',
    icon: 'Settings',
    placement: 'session-toolbar',
    scope: { type: 'global' },
    order: 0,
    ...overrides,
  }
}

let initialButtons: CustomButton[]
let initialGroups: CustomButtonGroup[]
let saveMock: ReturnType<typeof vi.fn>
let groupSaveMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  // Prevent the store from seeding the built-in review-loop button on load.
  localStorage.setItem('codecrucible.builtin-buttons.seeded', '1')
  initialButtons = []
  initialGroups = []
  saveMock = vi.fn(async () => {})
  groupSaveMock = vi.fn(async () => {})
  ;(window as any).api = {
    button: {
      list: vi.fn(async () => initialButtons),
      save: saveMock,
      groupList: vi.fn(async () => initialGroups),
      groupSave: groupSaveMock,
    },
  }
  useButtonStore.setState({ buttons: [], groups: [], runningButtons: {} })
  useProjectStore.setState({
    projects: [
      { id: 'p1', name: 'Alpha', repoPath: '/repos/alpha' },
      { id: 'p2', name: 'Beta', repoPath: '/repos/beta' },
    ],
    activeProjectId: 'p1',
    claudeAccounts: [],
  } as any)
  useToastStore.setState({ toasts: [] })
})

function buttonRow(label: string): HTMLElement {
  return screen.getByText(label).closest('.group') as HTMLElement
}

describe('ButtonSettings', () => {
  it('shows the empty state when no buttons or groups exist', async () => {
    render(<ButtonSettings />)
    expect(
      await screen.findByText('No custom buttons yet. Click "Add Button" to create one.')
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Custom Buttons' })).toBeInTheDocument()
  })

  it('lists loaded buttons grouped under their placement heading', async () => {
    initialButtons = [
      makeButton({ id: 'b1', label: 'Toolbar Thing', placement: 'session-toolbar' }),
      makeButton({ id: 'b2', label: 'Tabs Thing', placement: 'project-tabs' }),
      makeButton({ id: 'b3', label: 'Bar Thing', placement: 'right-activity-bar' }),
    ]
    render(<ButtonSettings />)
    expect(await screen.findByText('Toolbar Thing')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Session' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Top Bar' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Right Bar' })).toBeInTheDocument()
  })

  it('omits placement headings that have no buttons', async () => {
    initialButtons = [makeButton({ id: 'b1', label: 'Solo' })]
    render(<ButtonSettings />)
    await screen.findByText('Solo')
    expect(screen.getByRole('heading', { name: 'Session' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Top Bar' })).not.toBeInTheDocument()
  })

  it('sorts buttons within a placement by order', async () => {
    initialButtons = [
      makeButton({ id: 'b1', label: 'ZZZ Later', order: 5 }),
      makeButton({ id: 'b2', label: 'AAA First', order: 1 }),
    ]
    render(<ButtonSettings />)
    await screen.findByText('AAA First')
    const labels = screen
      .getAllByText(/AAA First|ZZZ Later/)
      .map((el) => el.textContent)
    expect(labels).toEqual(['AAA First', 'ZZZ Later'])
  })

  it('renders scope chips for global, all-projects and named project scopes', async () => {
    initialButtons = [
      makeButton({ id: 'b1', label: 'One', scope: { type: 'global' } }),
      makeButton({ id: 'b2', label: 'Two', scope: { type: 'all-projects' } }),
      makeButton({ id: 'b3', label: 'Three', scope: { type: 'projects', projectIds: ['p1', 'p2'] } }),
    ]
    render(<ButtonSettings />)
    await screen.findByText('One')
    expect(within(buttonRow('One')).getByText('Global')).toBeInTheDocument()
    expect(within(buttonRow('Two')).getByText('All Projects')).toBeInTheDocument()
    expect(within(buttonRow('Three')).getByText('Alpha, Beta')).toBeInTheDocument()
  })

  it('falls back to the raw project id when a scoped project is unknown', async () => {
    initialButtons = [
      makeButton({ id: 'b1', label: 'Orphan', scope: { type: 'projects', projectIds: ['missing'] } }),
    ]
    render(<ButtonSettings />)
    await screen.findByText('Orphan')
    expect(within(buttonRow('Orphan')).getByText('missing')).toBeInTheDocument()
  })

  it('shows the shortcut chip and action-type tag on rows', async () => {
    initialButtons = [
      makeButton({ id: 'b1', label: 'Sh', actionType: 'shell', shortcut: 'Cmd+T' }),
      makeButton({ id: 'b2', label: 'Cl', actionType: 'claude' }),
      makeButton({ id: 'b3', label: 'Ap', actionType: 'app-action', command: 'session:create' }),
    ]
    render(<ButtonSettings />)
    await screen.findByText('Sh')
    expect(within(buttonRow('Sh')).getByText('Cmd+T')).toBeInTheDocument()
    expect(within(buttonRow('Sh')).getByText('Shell')).toBeInTheDocument()
    expect(within(buttonRow('Cl')).getByText('Claude')).toBeInTheDocument()
    expect(within(buttonRow('Ap')).getByText('Action')).toBeInTheDocument()
  })

  it('opens the Add Button dialog with Create disabled until valid', async () => {
    const user = userEvent.setup()
    render(<ButtonSettings />)
    await user.click(screen.getByRole('button', { name: 'Add Button' }))
    const dialog = screen.getByRole('dialog', { name: 'Add Button' })
    const create = within(dialog).getByRole('button', { name: 'Create' })
    expect(create).toBeDisabled()
    await user.type(within(dialog).getByLabelText('Label'), 'Lint')
    expect(create).toBeDisabled()
    await user.type(within(dialog).getByPlaceholderText('npm test'), 'npm run lint')
    expect(create).toBeEnabled()
  })

  it('creating a button persists it with order 0 and global scope', async () => {
    const user = userEvent.setup()
    render(<ButtonSettings />)
    await user.click(screen.getByRole('button', { name: 'Add Button' }))
    const dialog = screen.getByRole('dialog', { name: 'Add Button' })
    await user.type(within(dialog).getByLabelText('Label'), 'Lint')
    await user.type(within(dialog).getByPlaceholderText('npm test'), 'npm run lint')
    await user.click(within(dialog).getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1))
    const [buttons] = saveMock.mock.calls[0]
    expect(buttons).toHaveLength(1)
    expect(buttons[0]).toMatchObject({
      label: 'Lint',
      command: 'npm run lint',
      placement: 'session-toolbar',
      actionType: 'shell',
      executionMode: 'background',
      scope: { type: 'global' },
      order: 0,
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('Lint')).toBeInTheDocument()
  })

  it('new buttons get order one past the max within their placement', async () => {
    const user = userEvent.setup()
    initialButtons = [makeButton({ id: 'b1', label: 'Existing', order: 4 })]
    render(<ButtonSettings />)
    await screen.findByText('Existing')
    await user.click(screen.getByRole('button', { name: 'Add Button' }))
    const dialog = screen.getByRole('dialog', { name: 'Add Button' })
    await user.type(within(dialog).getByLabelText('Label'), 'Next')
    await user.type(within(dialog).getByPlaceholderText('npm test'), 'cmd')
    await user.click(within(dialog).getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(saveMock).toHaveBeenCalled())
    const [buttons] = saveMock.mock.calls[0]
    const created = buttons.find((b: CustomButton) => b.label === 'Next')
    expect(created.order).toBe(5)
  })

  it('placement and execution mode chosen in the form are persisted', async () => {
    const user = userEvent.setup()
    render(<ButtonSettings />)
    await user.click(screen.getByRole('button', { name: 'Add Button' }))
    const dialog = screen.getByRole('dialog', { name: 'Add Button' })
    await user.click(within(dialog).getByRole('radio', { name: 'Top Bar' }))
    await user.click(within(dialog).getByRole('radio', { name: 'Terminal' }))
    await user.type(within(dialog).getByLabelText('Label'), 'X')
    await user.type(within(dialog).getByPlaceholderText('npm test'), 'cmd')
    await user.click(within(dialog).getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(saveMock).toHaveBeenCalled())
    const [buttons] = saveMock.mock.calls[0]
    expect(buttons[0]).toMatchObject({ placement: 'project-tabs', executionMode: 'terminal' })
  })

  it('Specific scope reveals project checkboxes and saves checked ids', async () => {
    const user = userEvent.setup()
    render(<ButtonSettings />)
    await user.click(screen.getByRole('button', { name: 'Add Button' }))
    const dialog = screen.getByRole('dialog', { name: 'Add Button' })
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('radio', { name: 'Specific' }))
    await user.click(within(dialog).getByRole('checkbox', { name: 'Beta' }))
    await user.type(within(dialog).getByLabelText('Label'), 'Scoped')
    await user.type(within(dialog).getByPlaceholderText('npm test'), 'cmd')
    await user.click(within(dialog).getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(saveMock).toHaveBeenCalled())
    const [buttons] = saveMock.mock.calls[0]
    expect(buttons[0].scope).toEqual({ type: 'projects', projectIds: ['p2'] })
  })

  it('switching to Claude action relabels the command field', async () => {
    const user = userEvent.setup()
    render(<ButtonSettings />)
    await user.click(screen.getByRole('button', { name: 'Add Button' }))
    const dialog = screen.getByRole('dialog', { name: 'Add Button' })
    expect(within(dialog).getByText('Command')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('radio', { name: 'Claude' }))
    expect(within(dialog).getByText('Claude Prompt')).toBeInTheDocument()
    expect(
      within(dialog).getByPlaceholderText('Run the test suite and fix any failures')
    ).toBeInTheDocument()
  })

  it('App Action mode swaps the command textarea for an action select and hides Execution', async () => {
    const user = userEvent.setup()
    render(<ButtonSettings />)
    await user.click(screen.getByRole('button', { name: 'Add Button' }))
    const dialog = screen.getByRole('dialog', { name: 'Add Button' })
    expect(within(dialog).getByRole('radio', { name: 'Background' })).toBeInTheDocument()
    await user.click(within(dialog).getByRole('radio', { name: 'App Action' }))
    expect(within(dialog).queryByRole('radio', { name: 'Background' })).not.toBeInTheDocument()
    expect(within(dialog).queryByPlaceholderText('npm test')).not.toBeInTheDocument()
    expect(within(dialog).getByRole('option', { name: 'Select an action...' })).toBeInTheDocument()
    expect(within(dialog).getByRole('option', { name: 'Delete Session' })).toBeInTheDocument()
  })

  it('selecting an app action with a default confirm message pre-fills it', async () => {
    const user = userEvent.setup()
    render(<ButtonSettings />)
    await user.click(screen.getByRole('button', { name: 'Add Button' }))
    const dialog = screen.getByRole('dialog', { name: 'Add Button' })
    await user.click(within(dialog).getByRole('radio', { name: 'App Action' }))
    const select = within(dialog).getByRole('combobox')
    await user.selectOptions(select, 'session:delete')
    expect(within(dialog).getByLabelText('Confirmation Message (optional)')).toHaveValue(
      'Delete this session? This will remove the worktree and branch. This cannot be undone.'
    )
  })

  it('switching action type clears any previously typed command', async () => {
    const user = userEvent.setup()
    render(<ButtonSettings />)
    await user.click(screen.getByRole('button', { name: 'Add Button' }))
    const dialog = screen.getByRole('dialog', { name: 'Add Button' })
    await user.type(within(dialog).getByPlaceholderText('npm test'), 'npm run x')
    await user.click(within(dialog).getByRole('radio', { name: 'Claude' }))
    expect(
      within(dialog).getByPlaceholderText('Run the test suite and fix any failures')
    ).toHaveValue('')
  })

  it('Edit opens the dialog pre-filled and saving keeps the id', async () => {
    const user = userEvent.setup()
    initialButtons = [makeButton({ id: 'b1', label: 'Old', command: 'old-cmd', order: 2 })]
    render(<ButtonSettings />)
    await screen.findByText('Old')
    await user.click(within(buttonRow('Old')).getByRole('button', { name: 'Edit' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit Button' })
    expect(within(dialog).getByLabelText('Label')).toHaveValue('Old')
    expect(within(dialog).getByPlaceholderText('npm test')).toHaveValue('old-cmd')

    const label = within(dialog).getByLabelText('Label')
    await user.clear(label)
    await user.type(label, 'Renamed')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(saveMock).toHaveBeenCalled())
    const [buttons] = saveMock.mock.calls[0]
    expect(buttons).toHaveLength(1)
    expect(buttons[0]).toMatchObject({ id: 'b1', label: 'Renamed', order: 2 })
  })

  it('Cancel closes the editor without persisting anything', async () => {
    const user = userEvent.setup()
    render(<ButtonSettings />)
    await user.click(screen.getByRole('button', { name: 'Add Button' }))
    const dialog = screen.getByRole('dialog', { name: 'Add Button' })
    await user.type(within(dialog).getByLabelText('Label'), 'Nope')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(saveMock).not.toHaveBeenCalled()
  })

  it('Delete removes the button from the list and persists the rest', async () => {
    const user = userEvent.setup()
    initialButtons = [
      makeButton({ id: 'b1', label: 'Keeper', order: 0 }),
      makeButton({ id: 'b2', label: 'Goner', order: 1 }),
    ]
    render(<ButtonSettings />)
    await screen.findByText('Goner')
    await user.click(within(buttonRow('Goner')).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(saveMock).toHaveBeenCalled())
    const [buttons] = saveMock.mock.calls[0]
    expect(buttons.map((b: CustomButton) => b.id)).toEqual(['b1'])
    expect(screen.queryByText('Goner')).not.toBeInTheDocument()
  })

  it('Move down swaps the order of adjacent buttons', async () => {
    const user = userEvent.setup()
    initialButtons = [
      makeButton({ id: 'b1', label: 'First', order: 0 }),
      makeButton({ id: 'b2', label: 'Second', order: 1 }),
    ]
    render(<ButtonSettings />)
    await screen.findByText('First')
    await user.click(within(buttonRow('First')).getByRole('button', { name: 'Move down' }))

    await waitFor(() => expect(saveMock).toHaveBeenCalled())
    const [buttons] = saveMock.mock.calls[0]
    const byId = Object.fromEntries(buttons.map((b: CustomButton) => [b.id, b.order]))
    expect(byId).toEqual({ b1: 1, b2: 0 })
  })

  it('Move up on the first button is a no-op', async () => {
    const user = userEvent.setup()
    initialButtons = [
      makeButton({ id: 'b1', label: 'First', order: 0 }),
      makeButton({ id: 'b2', label: 'Second', order: 1 }),
    ]
    render(<ButtonSettings />)
    await screen.findByText('First')
    await user.click(within(buttonRow('First')).getByRole('button', { name: 'Move up' }))
    expect(saveMock).not.toHaveBeenCalled()
  })

  it('Add Group dialog requires a label before Create enables', async () => {
    const user = userEvent.setup()
    render(<ButtonSettings />)
    await user.click(screen.getByRole('button', { name: 'Add Group' }))
    const dialog = screen.getByRole('dialog', { name: 'Add Button Group' })
    const create = within(dialog).getByRole('button', { name: 'Create' })
    expect(create).toBeDisabled()
    await user.type(within(dialog).getByLabelText('Group Label'), 'Tools')
    expect(create).toBeEnabled()
  })

  it('creating a group persists it and renders a group card', async () => {
    const user = userEvent.setup()
    render(<ButtonSettings />)
    await user.click(screen.getByRole('button', { name: 'Add Group' }))
    const dialog = screen.getByRole('dialog', { name: 'Add Button Group' })
    await user.type(within(dialog).getByLabelText('Group Label'), 'Tools')
    await user.click(within(dialog).getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(groupSaveMock).toHaveBeenCalledTimes(1))
    const [groups] = groupSaveMock.mock.calls[0]
    expect(groups[0]).toMatchObject({
      label: 'Tools',
      placement: 'session-toolbar',
      scope: { type: 'global' },
      order: 0,
    })
    expect(screen.getByText('Tools')).toBeInTheDocument()
    expect(screen.getByText('group')).toBeInTheDocument()
  })

  it('buttons assigned to a group render inside its card', async () => {
    initialGroups = [makeGroup({ id: 'g1', label: 'Tools' })]
    initialButtons = [
      makeButton({ id: 'b1', label: 'Member', groupId: 'g1' }),
      makeButton({ id: 'b2', label: 'Loner' }),
    ]
    render(<ButtonSettings />)
    await screen.findByText('Tools')
    const groupCard = screen.getByText('Tools').closest('.rounded-md') as HTMLElement
    expect(within(groupCard).getByText('Member')).toBeInTheDocument()
    expect(within(groupCard).queryByText('Loner')).not.toBeInTheDocument()
  })

  it('removing a group persists the removal and ungroups its buttons', async () => {
    const user = userEvent.setup()
    initialGroups = [makeGroup({ id: 'g1', label: 'Tools' })]
    initialButtons = [makeButton({ id: 'b1', label: 'Member', groupId: 'g1' })]
    render(<ButtonSettings />)
    await screen.findByText('Tools')
    await user.click(screen.getByRole('button', { name: 'Remove group' }))

    await waitFor(() => expect(groupSaveMock).toHaveBeenCalledWith([]))
    await waitFor(() => expect(saveMock).toHaveBeenCalled())
    const [buttons] = saveMock.mock.calls[0]
    expect(buttons[0].groupId).toBeUndefined()
    expect(useButtonStore.getState().groups).toEqual([])
  })

  it('the editor offers a Group select listing groups for the chosen placement', async () => {
    const user = userEvent.setup()
    initialGroups = [
      makeGroup({ id: 'g1', label: 'Toolbar Group', placement: 'session-toolbar' }),
      makeGroup({ id: 'g2', label: 'Tabs Group', placement: 'project-tabs' }),
    ]
    render(<ButtonSettings />)
    await screen.findByText('Toolbar Group')
    await user.click(screen.getByRole('button', { name: 'Add Button' }))
    const dialog = screen.getByRole('dialog', { name: 'Add Button' })
    expect(within(dialog).getByRole('option', { name: 'Toolbar Group' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('option', { name: 'Tabs Group' })).not.toBeInTheDocument()
  })

  it('saving with a group selection sets groupId on the new button', async () => {
    const user = userEvent.setup()
    initialGroups = [makeGroup({ id: 'g1', label: 'Tools' })]
    render(<ButtonSettings />)
    await screen.findByText('Tools')
    await user.click(screen.getByRole('button', { name: 'Add Button' }))
    const dialog = screen.getByRole('dialog', { name: 'Add Button' })
    await user.type(within(dialog).getByLabelText('Label'), 'Grouped')
    await user.type(within(dialog).getByPlaceholderText('npm test'), 'cmd')
    await user.selectOptions(within(dialog).getByRole('combobox'), 'g1')
    await user.click(within(dialog).getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(saveMock).toHaveBeenCalled())
    const [buttons] = saveMock.mock.calls[0]
    expect(buttons[0]).toMatchObject({ label: 'Grouped', groupId: 'g1' })
  })

  it('shortcut and confirm message inputs are persisted on the button', async () => {
    const user = userEvent.setup()
    render(<ButtonSettings />)
    await user.click(screen.getByRole('button', { name: 'Add Button' }))
    const dialog = screen.getByRole('dialog', { name: 'Add Button' })
    await user.type(within(dialog).getByLabelText('Label'), 'Danger')
    await user.type(within(dialog).getByPlaceholderText('npm test'), './deploy.sh')
    await user.type(within(dialog).getByLabelText('Keyboard Shortcut (optional)'), 'Cmd+D')
    await user.type(within(dialog).getByLabelText('Confirmation Message (optional)'), 'Sure?')
    await user.click(within(dialog).getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(saveMock).toHaveBeenCalled())
    const [buttons] = saveMock.mock.calls[0]
    expect(buttons[0]).toMatchObject({ shortcut: 'Cmd+D', confirmMessage: 'Sure?' })
  })
})
