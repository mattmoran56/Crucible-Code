import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PRListDisplaySettings } from '../../../../src/renderer/components/settings/PRListDisplaySettings'
import { usePRListDisplayStore } from '../../../../src/renderer/stores/prListDisplayStore'
import {
  DEFAULT_PR_LIST_DISPLAY,
  PR_LIST_FIELDS,
  type PRListDisplay,
} from '../../../../src/shared/prDisplay'
import type { PRLabel, Project } from '../../../../src/shared/types'

const projectA: Project = { id: 'proj-a', name: 'Alpha', repoPath: '/repos/alpha' }
const projectB: Project = { id: 'proj-b', name: 'Beta', repoPath: '/repos/beta' }

const repoLabels: PRLabel[] = [
  { name: 'bug', color: 'd73a4a' },
  { name: 'enhancement', color: 'a2eeef' },
  { name: 'docs', color: '0075ca' },
]

let listRepoLabelsMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  localStorage.clear()
  listRepoLabelsMock = vi.fn(async () => repoLabels)
  ;(window as any).api = {
    github: { listRepoLabels: listRepoLabelsMock },
  }
  usePRListDisplayStore.setState({
    default: DEFAULT_PR_LIST_DISPLAY,
    byRepo: {},
  })
})

function card(title: string): HTMLElement {
  return screen.getByText(title).closest('.rounded-md') as HTMLElement
}

function withLabels(display: PRListDisplay, labels: boolean): PRListDisplay {
  return { ...display, fields: { ...display.fields, labels } }
}

describe('PRListDisplaySettings', () => {
  it('renders the heading and description', () => {
    render(<PRListDisplaySettings projects={[]} />)
    expect(screen.getByRole('heading', { name: 'Pull Request List' })).toBeInTheDocument()
    expect(screen.getByText(/Choose which details show on each PR/)).toBeInTheDocument()
  })

  it('always renders the Default card', () => {
    render(<PRListDisplaySettings projects={[]} />)
    expect(screen.getByText('Default')).toBeInTheDocument()
    expect(screen.getByText('Applied to projects without their own settings.')).toBeInTheDocument()
  })

  it('renders a card per project with name and repo path', () => {
    render(<PRListDisplaySettings projects={[projectA, projectB]} />)
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('/repos/alpha')).toBeInTheDocument()
    expect(screen.getByText('Beta')).toBeInTheDocument()
  })

  it('cards start collapsed showing an Edit button and no checkboxes', () => {
    render(<PRListDisplaySettings projects={[projectA]} />)
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(2)
    expect(screen.queryByText('State')).not.toBeInTheDocument()
  })

  it('Edit expands the card with one checkbox row per PR list field', async () => {
    const user = userEvent.setup()
    render(<PRListDisplaySettings projects={[]} />)
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    for (const field of PR_LIST_FIELDS) {
      expect(screen.getByText(field.label)).toBeInTheDocument()
    }
  })

  it('the Edit button becomes Hide when expanded and collapses on click', async () => {
    const user = userEvent.setup()
    render(<PRListDisplaySettings projects={[]} />)
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const hide = screen.getByRole('button', { name: 'Hide' })
    await user.click(hide)
    expect(screen.queryByText('State')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
  })

  it('clicking the card title also toggles expansion', async () => {
    const user = userEvent.setup()
    render(<PRListDisplaySettings projects={[]} />)
    await user.click(screen.getByText('Default'))
    expect(screen.getByText('State')).toBeInTheDocument()
  })

  it('default-enabled fields render with a check mark and disabled ones without', async () => {
    const user = userEvent.setup()
    render(<PRListDisplaySettings projects={[]} />)
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const stateRow = screen.getByText('State').closest('button') as HTMLElement
    expect(within(stateRow).getByText('✓')).toBeInTheDocument()
    const labelsRow = screen.getByText('Labels').closest('button') as HTMLElement
    expect(within(labelsRow).queryByText('✓')).not.toBeInTheDocument()
  })

  it('toggling a field on the Default card updates the store default', async () => {
    const user = userEvent.setup()
    render(<PRListDisplaySettings projects={[]} />)
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByText('Updated').closest('button') as HTMLElement)
    expect(usePRListDisplayStore.getState().default.fields.updatedAt).toBe(true)
  })

  it('toggling a field on a project card writes a byRepo override', async () => {
    const user = userEvent.setup()
    render(<PRListDisplaySettings projects={[projectA]} />)
    await user.click(within(card('Alpha')).getByRole('button', { name: 'Edit' }))
    await user.click(within(card('Alpha')).getByText('Author').closest('button') as HTMLElement)
    const { byRepo } = usePRListDisplayStore.getState()
    expect(byRepo['/repos/alpha'].fields.author).toBe(false)
    // Default stays untouched.
    expect(usePRListDisplayStore.getState().default.fields.author).toBe(true)
  })

  it('shows the Customized badge and Reset button once a project diverges', () => {
    usePRListDisplayStore.setState({
      byRepo: { '/repos/alpha': withLabels(DEFAULT_PR_LIST_DISPLAY, true) },
    })
    render(<PRListDisplaySettings projects={[projectA, projectB]} />)
    expect(within(card('Alpha')).getByText('Customized')).toBeInTheDocument()
    expect(within(card('Alpha')).getByRole('button', { name: 'Reset to default' })).toBeInTheDocument()
    expect(within(card('Beta')).queryByText('Customized')).not.toBeInTheDocument()
  })

  it('an override identical to the default is not marked Customized', () => {
    usePRListDisplayStore.setState({
      byRepo: { '/repos/alpha': { ...DEFAULT_PR_LIST_DISPLAY } },
    })
    render(<PRListDisplaySettings projects={[projectA]} />)
    expect(screen.queryByText('Customized')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reset to default' })).not.toBeInTheDocument()
  })

  it('Reset to default removes the override and the badge', async () => {
    const user = userEvent.setup()
    usePRListDisplayStore.setState({
      byRepo: { '/repos/alpha': withLabels(DEFAULT_PR_LIST_DISPLAY, true) },
    })
    render(<PRListDisplaySettings projects={[projectA]} />)
    await user.click(screen.getByRole('button', { name: 'Reset to default' }))
    expect(usePRListDisplayStore.getState().byRepo['/repos/alpha']).toBeUndefined()
    expect(screen.queryByText('Customized')).not.toBeInTheDocument()
  })

  it('expanding a project card with labels enabled fetches repo labels once', async () => {
    const user = userEvent.setup()
    usePRListDisplayStore.setState({
      byRepo: { '/repos/alpha': withLabels(DEFAULT_PR_LIST_DISPLAY, true) },
    })
    render(<PRListDisplaySettings projects={[projectA]} />)
    await user.click(within(card('Alpha')).getByRole('button', { name: 'Edit' }))
    await waitFor(() => expect(listRepoLabelsMock).toHaveBeenCalledWith('/repos/alpha'))
    expect(listRepoLabelsMock).toHaveBeenCalledTimes(1)
  })

  it('does not fetch labels when the labels field is disabled', async () => {
    const user = userEvent.setup()
    render(<PRListDisplaySettings projects={[projectA]} />)
    await user.click(within(card('Alpha')).getByRole('button', { name: 'Edit' }))
    expect(listRepoLabelsMock).not.toHaveBeenCalled()
  })

  it('shows the label filter section only when the labels field is on', async () => {
    const user = userEvent.setup()
    usePRListDisplayStore.setState({
      byRepo: { '/repos/alpha': withLabels(DEFAULT_PR_LIST_DISPLAY, true) },
    })
    render(<PRListDisplaySettings projects={[projectA]} />)
    await user.click(within(card('Alpha')).getByRole('button', { name: 'Edit' }))
    expect(screen.getByText('Labels to show')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'All' })).toHaveAttribute('aria-checked', 'true')
  })

  it('switching the filter to Only selected stores an empty names list', async () => {
    const user = userEvent.setup()
    usePRListDisplayStore.setState({
      byRepo: { '/repos/alpha': withLabels(DEFAULT_PR_LIST_DISPLAY, true) },
    })
    render(<PRListDisplaySettings projects={[projectA]} />)
    await user.click(within(card('Alpha')).getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('radio', { name: 'Only selected' }))
    expect(usePRListDisplayStore.getState().byRepo['/repos/alpha'].labelFilter).toEqual({
      mode: 'only',
      names: [],
    })
  })

  it('renders fetched repo labels as chips in Only selected mode', async () => {
    const user = userEvent.setup()
    usePRListDisplayStore.setState({
      byRepo: {
        '/repos/alpha': {
          ...withLabels(DEFAULT_PR_LIST_DISPLAY, true),
          labelFilter: { mode: 'only', names: [] },
        },
      },
    })
    render(<PRListDisplaySettings projects={[projectA]} />)
    await user.click(within(card('Alpha')).getByRole('button', { name: 'Edit' }))
    expect(await screen.findByText('bug')).toBeInTheDocument()
    expect(screen.getByText('enhancement')).toBeInTheDocument()
    expect(screen.getByText('docs')).toBeInTheDocument()
  })

  it('clicking a label chip adds its name to the filter', async () => {
    const user = userEvent.setup()
    usePRListDisplayStore.setState({
      byRepo: {
        '/repos/alpha': {
          ...withLabels(DEFAULT_PR_LIST_DISPLAY, true),
          labelFilter: { mode: 'only', names: [] },
        },
      },
    })
    render(<PRListDisplaySettings projects={[projectA]} />)
    await user.click(within(card('Alpha')).getByRole('button', { name: 'Edit' }))
    await user.click(await screen.findByText('bug'))
    const filter = usePRListDisplayStore.getState().byRepo['/repos/alpha'].labelFilter
    expect(filter).toEqual({ mode: 'only', names: ['bug'] })
  })

  it('clicking an already-selected chip removes it from the filter', async () => {
    const user = userEvent.setup()
    usePRListDisplayStore.setState({
      byRepo: {
        '/repos/alpha': {
          ...withLabels(DEFAULT_PR_LIST_DISPLAY, true),
          labelFilter: { mode: 'only', names: ['bug', 'docs'] },
        },
      },
    })
    render(<PRListDisplaySettings projects={[projectA]} />)
    await user.click(within(card('Alpha')).getByRole('button', { name: 'Edit' }))
    await user.click(await screen.findByText('bug'))
    const filter = usePRListDisplayStore.getState().byRepo['/repos/alpha'].labelFilter
    expect(filter).toEqual({ mode: 'only', names: ['docs'] })
  })

  it('selected names missing from the fetched labels still render as chips', async () => {
    const user = userEvent.setup()
    usePRListDisplayStore.setState({
      default: {
        ...withLabels(DEFAULT_PR_LIST_DISPLAY, true),
        labelFilter: { mode: 'only', names: ['ghost-label'] },
      },
    })
    render(<PRListDisplaySettings projects={[]} />)
    // Default card has no repo to fetch from; the chosen name still shows.
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByText('ghost-label')).toBeInTheDocument()
  })

  it('shows the empty message when no labels exist and none are selected', async () => {
    const user = userEvent.setup()
    listRepoLabelsMock.mockResolvedValue([])
    usePRListDisplayStore.setState({
      byRepo: {
        '/repos/alpha': {
          ...withLabels(DEFAULT_PR_LIST_DISPLAY, true),
          labelFilter: { mode: 'only', names: [] },
        },
      },
    })
    render(<PRListDisplaySettings projects={[projectA]} />)
    await user.click(within(card('Alpha')).getByRole('button', { name: 'Edit' }))
    expect(await screen.findByText('No labels found in this repository.')).toBeInTheDocument()
  })

  it('shows a loading message while the label fetch is pending', async () => {
    const user = userEvent.setup()
    listRepoLabelsMock.mockImplementation(() => new Promise(() => {}))
    usePRListDisplayStore.setState({
      byRepo: {
        '/repos/alpha': {
          ...withLabels(DEFAULT_PR_LIST_DISPLAY, true),
          labelFilter: { mode: 'only', names: [] },
        },
      },
    })
    render(<PRListDisplaySettings projects={[projectA]} />)
    await user.click(within(card('Alpha')).getByRole('button', { name: 'Edit' }))
    expect(await screen.findByText('Loading labels…')).toBeInTheDocument()
  })

  it('switching back to All replaces the only-filter and hides the picker', async () => {
    const user = userEvent.setup()
    usePRListDisplayStore.setState({
      byRepo: {
        '/repos/alpha': {
          ...withLabels(DEFAULT_PR_LIST_DISPLAY, true),
          labelFilter: { mode: 'only', names: ['bug'] },
        },
      },
    })
    render(<PRListDisplaySettings projects={[projectA]} />)
    await user.click(within(card('Alpha')).getByRole('button', { name: 'Edit' }))
    await screen.findByText('bug')
    await user.click(screen.getByRole('radio', { name: 'All' }))
    expect(usePRListDisplayStore.getState().byRepo['/repos/alpha'].labelFilter).toEqual({
      mode: 'all',
    })
    expect(screen.queryByText('bug')).not.toBeInTheDocument()
  })
})
