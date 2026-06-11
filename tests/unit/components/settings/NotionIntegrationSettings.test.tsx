import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NotionIntegrationSettings } from '../../../../src/renderer/components/settings/NotionIntegrationSettings'
import {
  useNotionStore,
  DEFAULT_NOTION_CONFIG,
} from '../../../../src/renderer/stores/notionStore'
import { useToastStore } from '../../../../src/renderer/stores/toastStore'
import type {
  NotionDatabaseSchema,
  NotionIntegrationConfig,
  Project,
} from '../../../../src/shared/types'

const projectA: Project = { id: 'proj-a', name: 'Alpha', repoPath: '/repos/alpha' }

const sampleSchema: NotionDatabaseSchema = {
  id: 'db-1',
  title: 'Crucible Tasks',
  titlePropertyName: 'Task',
  properties: [
    { name: 'Task', type: 'title' },
    {
      name: 'Status',
      type: 'status',
      options: [
        { id: 'ready', name: 'Ready' },
        { id: 'in_progress', name: 'In Progress' },
        { id: 'done', name: 'Done' },
      ],
    },
    { name: 'Crucible Branch', type: 'url' },
  ],
}

const configuredConfig: NotionIntegrationConfig = {
  ...DEFAULT_NOTION_CONFIG,
  enabled: true,
  apiToken: 'secret_token',
  databaseId: 'db-1234',
  filters: [{ property: 'Status', type: 'status', operator: 'equals', value: 'Ready' }],
}

let configs: Record<string, NotionIntegrationConfig>
let saveConfigMock: ReturnType<typeof vi.fn>
let testConnectionMock: ReturnType<typeof vi.fn>
let getSchemaMock: ReturnType<typeof vi.fn>
let clearPickedUpMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  configs = {}
  saveConfigMock = vi.fn(async () => {})
  testConnectionMock = vi.fn(async () => ({ ok: true, taskCount: 3 }))
  getSchemaMock = vi.fn(async () => sampleSchema)
  clearPickedUpMock = vi.fn(async () => {})
  ;(window as any).api = {
    notion: {
      loadConfig: vi.fn(async (projectId: string) => configs[projectId] ?? null),
      saveConfig: saveConfigMock,
      testConnection: testConnectionMock,
      getDatabaseSchema: getSchemaMock,
      clearPickedUp: clearPickedUpMock,
      getConfigPath: vi.fn(async () => '/cfg/notion-integration.json'),
      listUsers: vi.fn(async () => []),
      listRelationOptions: vi.fn(async () => []),
    },
  }
  useNotionStore.setState({
    configByProject: {},
    schemaByProject: {},
    loadingProjects: new Set(),
    configPath: '/cfg/notion-integration.json',
  })
  useToastStore.setState({ toasts: [] })
})

function seedConfig(projectId: string, config: NotionIntegrationConfig) {
  configs[projectId] = config
  useNotionStore.setState({ configByProject: { [projectId]: config } })
}

function toasts() {
  return useToastStore.getState().toasts
}

async function expand(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Configure' }))
}

describe('NotionIntegrationSettings', () => {
  it('renders nothing when there are no projects', () => {
    const { container } = render(<NotionIntegrationSettings projects={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the heading and the list of available placeholders', () => {
    render(<NotionIntegrationSettings projects={[projectA]} />)
    expect(screen.getByRole('heading', { name: 'Notion Integration' })).toBeInTheDocument()
    expect(screen.getByText('{{taskUrl}}')).toBeInTheDocument()
    expect(screen.getByText('{{taskTitleSlug}}')).toBeInTheDocument()
    expect(screen.getByText('{{branch}}')).toBeInTheDocument()
  })

  it('shows "Disabled" as the summary once a default config has loaded', async () => {
    render(<NotionIntegrationSettings projects={[projectA]} />)
    expect(await screen.findByText('Disabled')).toBeInTheDocument()
  })

  it('shows "Incomplete" when enabled but missing token or database id', async () => {
    seedConfig('proj-a', { ...DEFAULT_NOTION_CONFIG, enabled: true, apiToken: 'tok' })
    render(<NotionIntegrationSettings projects={[projectA]} />)
    expect(await screen.findByText('Incomplete')).toBeInTheDocument()
  })

  it('summarises a configured single-group filter as "Polling · 1 filter"', async () => {
    seedConfig('proj-a', configuredConfig)
    render(<NotionIntegrationSettings projects={[projectA]} />)
    expect(await screen.findByText('Polling · 1 filter')).toBeInTheDocument()
  })

  it('pluralises the filter count in the summary', async () => {
    seedConfig('proj-a', {
      ...configuredConfig,
      filters: [
        { property: 'Status', type: 'status', operator: 'equals', value: 'Ready' },
        { property: 'Task', type: 'title', operator: 'contains', value: 'x' },
      ],
    })
    render(<NotionIntegrationSettings projects={[projectA]} />)
    expect(await screen.findByText('Polling · 2 filters')).toBeInTheDocument()
  })

  it('summarises multi-group configs with group and condition counts', async () => {
    seedConfig('proj-a', {
      ...configuredConfig,
      filters: [],
      filterGroups: [
        [
          { property: 'Status', type: 'status', operator: 'equals', value: 'Ready' },
          { property: 'Task', type: 'title', operator: 'contains', value: 'a' },
        ],
        [{ property: 'Status', type: 'status', operator: 'equals', value: 'Done' }],
      ],
    })
    render(<NotionIntegrationSettings projects={[projectA]} />)
    expect(await screen.findByText('Polling · 2 groups · 3 conditions')).toBeInTheDocument()
  })

  it('Configure expands the form with token and database inputs pre-filled', async () => {
    const user = userEvent.setup()
    seedConfig('proj-a', configuredConfig)
    render(<NotionIntegrationSettings projects={[projectA]} />)
    await expand(user)
    expect(screen.getByLabelText('API token')).toHaveValue('secret_token')
    expect(screen.getByLabelText('Database ID (or paste a Notion DB URL)')).toHaveValue('db-1234')
    expect(screen.getByRole('button', { name: 'Hide' })).toBeInTheDocument()
  })

  it('Hide collapses the form again', async () => {
    const user = userEvent.setup()
    render(<NotionIntegrationSettings projects={[projectA]} />)
    await expand(user)
    await user.click(screen.getByRole('button', { name: 'Hide' }))
    expect(screen.queryByLabelText('API token')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Configure' })).toBeInTheDocument()
  })

  it('the API token field is a password input', async () => {
    const user = userEvent.setup()
    render(<NotionIntegrationSettings projects={[projectA]} />)
    await expand(user)
    expect(screen.getByLabelText('API token')).toHaveAttribute('type', 'password')
  })

  it('switching the toggle to On saves the config with enabled true', async () => {
    const user = userEvent.setup()
    seedConfig('proj-a', { ...configuredConfig, enabled: false })
    render(<NotionIntegrationSettings projects={[projectA]} />)
    await screen.findByText('Disabled')
    await user.click(screen.getByRole('radio', { name: 'On' }))
    await waitFor(() =>
      expect(saveConfigMock).toHaveBeenCalledWith(
        'proj-a',
        expect.objectContaining({ enabled: true }),
        { backfill: false }
      )
    )
    expect(useNotionStore.getState().configByProject['proj-a'].enabled).toBe(true)
  })

  it('blurring an edited token field persists it and flashes Saved', async () => {
    const user = userEvent.setup()
    seedConfig('proj-a', configuredConfig)
    render(<NotionIntegrationSettings projects={[projectA]} />)
    await expand(user)
    const token = screen.getByLabelText('API token')
    fireEvent.change(token, { target: { value: 'secret_new' } })
    fireEvent.blur(token)
    await waitFor(() =>
      expect(saveConfigMock).toHaveBeenCalledWith(
        'proj-a',
        expect.objectContaining({ apiToken: 'secret_new' }),
        { backfill: false }
      )
    )
    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })

  it('Test connection is disabled until both token and database id exist', async () => {
    const user = userEvent.setup()
    render(<NotionIntegrationSettings projects={[projectA]} />)
    await expand(user)
    const testBtn = screen.getByRole('button', { name: 'Test connection' })
    expect(testBtn).toBeDisabled()
    fireEvent.change(screen.getByLabelText('API token'), { target: { value: 'tok' } })
    expect(testBtn).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Database ID (or paste a Notion DB URL)'), {
      target: { value: 'db' },
    })
    expect(testBtn).toBeEnabled()
  })

  it('a successful connection test toasts the match count and loads the schema', async () => {
    const user = userEvent.setup()
    seedConfig('proj-a', configuredConfig)
    render(<NotionIntegrationSettings projects={[projectA]} />)
    await expand(user)
    await user.click(screen.getByRole('button', { name: 'Test connection' }))

    await waitFor(() => {
      expect(testConnectionMock).toHaveBeenCalledWith('secret_token', 'db-1234')
      expect(
        toasts().some(
          (t) =>
            t.type === 'success' &&
            t.message === 'Connection ok — 3 tasks match this filter currently'
        )
      ).toBe(true)
    })
    await waitFor(() => expect(getSchemaMock).toHaveBeenCalledWith('secret_token', 'db-1234'))
    // Schema arrival unlocks the Title property picker.
    expect(await screen.findByText('Title property')).toBeInTheDocument()
    expect(useNotionStore.getState().schemaByProject['proj-a']).toEqual(sampleSchema)
  })

  it('a failed connection test surfaces the error as a toast', async () => {
    const user = userEvent.setup()
    testConnectionMock.mockResolvedValue({ ok: false, error: 'bad token' })
    seedConfig('proj-a', configuredConfig)
    render(<NotionIntegrationSettings projects={[projectA]} />)
    await expand(user)
    await user.click(screen.getByRole('button', { name: 'Test connection' }))
    await waitFor(() =>
      expect(toasts().some((t) => t.type === 'error' && t.message === 'bad token')).toBe(true)
    )
    expect(getSchemaMock).not.toHaveBeenCalled()
  })

  it('shows the no-filter hint when no filters are configured', async () => {
    const user = userEvent.setup()
    render(<NotionIntegrationSettings projects={[projectA]} />)
    await expand(user)
    expect(
      screen.getByText('No filter — every row in the database is picked up.')
    ).toBeInTheDocument()
    expect(screen.getByText('Filters (ANDed; empty = no filter)')).toBeInTheDocument()
  })

  it('+ Add group seeds one condition and saves it in the legacy filters shape', async () => {
    const user = userEvent.setup()
    render(<NotionIntegrationSettings projects={[projectA]} />)
    await screen.findByText('Disabled')
    await expand(user)
    await user.click(screen.getByRole('button', { name: '+ Add group' }))
    await waitFor(() =>
      expect(saveConfigMock).toHaveBeenCalledWith(
        'proj-a',
        expect.objectContaining({
          filters: [{ property: '', type: 'rich_text', operator: 'equals', value: '' }],
          filterGroups: undefined,
        }),
        { backfill: false }
      )
    )
  })

  it('renders multi-group filters with an OR divider and numbered groups', async () => {
    const user = userEvent.setup()
    seedConfig('proj-a', {
      ...configuredConfig,
      filters: [],
      filterGroups: [
        [{ property: 'Status', type: 'status', operator: 'equals', value: 'Ready' }],
        [{ property: 'Task', type: 'title', operator: 'contains', value: 'x' }],
      ],
    })
    render(<NotionIntegrationSettings projects={[projectA]} />)
    await expand(user)
    expect(screen.getByText('OR')).toBeInTheDocument()
    expect(screen.getByText('Group 1')).toBeInTheDocument()
    expect(screen.getByText('Group 2')).toBeInTheDocument()
    expect(
      screen.getByText('Filter groups — match any group (groups ORed; conditions ANDed)')
    ).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Remove group' })).toHaveLength(2)
  })

  it('removing one of two groups collapses back to the legacy single-group shape', async () => {
    const user = userEvent.setup()
    seedConfig('proj-a', {
      ...configuredConfig,
      filters: [],
      filterGroups: [
        [{ property: 'Status', type: 'status', operator: 'equals', value: 'Ready' }],
        [{ property: 'Task', type: 'title', operator: 'contains', value: 'x' }],
      ],
    })
    render(<NotionIntegrationSettings projects={[projectA]} />)
    await expand(user)
    await user.click(screen.getAllByRole('button', { name: 'Remove group' })[1])
    await waitFor(() =>
      expect(saveConfigMock).toHaveBeenCalledWith(
        'proj-a',
        expect.objectContaining({
          filters: [{ property: 'Status', type: 'status', operator: 'equals', value: 'Ready' }],
          filterGroups: undefined,
        }),
        { backfill: false }
      )
    )
  })

  it('with a loaded schema the filter row offers property and status-value selects', async () => {
    const user = userEvent.setup()
    seedConfig('proj-a', configuredConfig)
    useNotionStore.setState({ schemaByProject: { 'proj-a': sampleSchema } })
    render(<NotionIntegrationSettings projects={[projectA]} />)
    await expand(user)
    // Property select shows schema property names.
    const propertySelect = screen.getByDisplayValue('Status')
    expect(within(propertySelect).getByRole('option', { name: 'Task' })).toBeInTheDocument()
    expect(
      within(propertySelect).getByRole('option', { name: 'Crucible Branch' })
    ).toBeInTheDocument()
    // Value select is constrained to the status options.
    const valueSelect = screen.getByDisplayValue('Ready')
    expect(within(valueSelect).getByRole('option', { name: 'In Progress' })).toBeInTheDocument()
    expect(within(valueSelect).getByRole('option', { name: 'Done' })).toBeInTheDocument()
  })

  it('changing the filter value persists the new filter', async () => {
    const user = userEvent.setup()
    seedConfig('proj-a', configuredConfig)
    useNotionStore.setState({ schemaByProject: { 'proj-a': sampleSchema } })
    render(<NotionIntegrationSettings projects={[projectA]} />)
    await expand(user)
    await user.selectOptions(screen.getByDisplayValue('Ready'), 'Done')
    await waitFor(() =>
      expect(saveConfigMock).toHaveBeenCalledWith(
        'proj-a',
        expect.objectContaining({
          filters: [expect.objectContaining({ property: 'Status', value: 'Done' })],
        }),
        { backfill: false }
      )
    )
  })

  it('selecting an is_empty operator hides the value control', async () => {
    const user = userEvent.setup()
    seedConfig('proj-a', configuredConfig)
    useNotionStore.setState({ schemaByProject: { 'proj-a': sampleSchema } })
    render(<NotionIntegrationSettings projects={[projectA]} />)
    await expand(user)
    expect(screen.getByDisplayValue('Ready')).toBeInTheDocument()
    await user.selectOptions(screen.getByDisplayValue('equals'), 'is_empty')
    expect(screen.queryByDisplayValue('Ready')).not.toBeInTheDocument()
    await waitFor(() =>
      expect(saveConfigMock).toHaveBeenCalledWith(
        'proj-a',
        expect.objectContaining({
          filters: [expect.objectContaining({ operator: 'is_empty' })],
        }),
        { backfill: false }
      )
    )
  })

  it('+ Add in the updates editor appends a pickup update and saves it', async () => {
    const user = userEvent.setup()
    seedConfig('proj-a', configuredConfig)
    useNotionStore.setState({ schemaByProject: { 'proj-a': sampleSchema } })
    render(<NotionIntegrationSettings projects={[projectA]} />)
    await expand(user)
    expect(screen.getByText('Property updates on pickup (placeholders ok)')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '+ Add' }))
    await waitFor(() =>
      expect(saveConfigMock).toHaveBeenCalledWith(
        'proj-a',
        expect.objectContaining({
          pickupUpdates: [{ property: 'Task', type: 'title', value: '' }],
        }),
        { backfill: false }
      )
    )
  })

  it('the backfill checkbox is forwarded to save options', async () => {
    const user = userEvent.setup()
    seedConfig('proj-a', configuredConfig)
    render(<NotionIntegrationSettings projects={[projectA]} />)
    await expand(user)
    await user.click(
      screen.getByRole('checkbox', {
        name: /On first enable, also pick up tasks that already match/,
      })
    )
    const token = screen.getByLabelText('API token')
    fireEvent.change(token, { target: { value: 'secret_other' } })
    fireEvent.blur(token)
    await waitFor(() =>
      expect(saveConfigMock).toHaveBeenCalledWith('proj-a', expect.anything(), { backfill: true })
    )
  })

  it('editing the startup prompt template saves on blur', async () => {
    const user = userEvent.setup()
    seedConfig('proj-a', configuredConfig)
    render(<NotionIntegrationSettings projects={[projectA]} />)
    await expand(user)
    const textarea = screen.getByDisplayValue('/notion-ticket {{taskUrl}}')
    fireEvent.change(textarea, { target: { value: '/custom {{taskUrl}}' } })
    fireEvent.blur(textarea)
    await waitFor(() =>
      expect(saveConfigMock).toHaveBeenCalledWith(
        'proj-a',
        expect.objectContaining({ startupPromptTemplate: '/custom {{taskUrl}}' }),
        { backfill: false }
      )
    )
  })

  it('Clear picked-up cache calls the api and toasts success', async () => {
    const user = userEvent.setup()
    seedConfig('proj-a', configuredConfig)
    render(<NotionIntegrationSettings projects={[projectA]} />)
    await expand(user)
    await user.click(screen.getByRole('button', { name: 'Clear picked-up cache' }))
    await waitFor(() => {
      expect(clearPickedUpMock).toHaveBeenCalledWith('proj-a')
      expect(
        toasts().some((t) => t.type === 'success' && t.message === 'Cleared picked-up cache')
      ).toBe(true)
    })
  })

  it('the MCP block starts collapsed and expands to show copy prompts and the config path', async () => {
    const user = userEvent.setup()
    render(<NotionIntegrationSettings projects={[projectA]} />)
    await expand(user)
    expect(screen.queryByText('Create a new Notion database')).not.toBeInTheDocument()
    await user.click(screen.getByText('Set up automatically via Notion MCP'))
    expect(screen.getByText('Create a new Notion database')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Copy' })).toHaveLength(2)
    expect(screen.getByText('/cfg/notion-integration.json')).toBeInTheDocument()
  })

  it('copying the new-database prompt writes it to the clipboard and toasts', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    render(<NotionIntegrationSettings projects={[projectA]} />)
    await expand(user)
    await user.click(screen.getByText('Set up automatically via Notion MCP'))
    await user.click(screen.getAllByRole('button', { name: 'Copy' })[0])
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1)
      expect(
        toasts().some((t) => t.type === 'success' && t.message === 'New-DB prompt copied')
      ).toBe(true)
    })
    const prompt = writeText.mock.calls[0][0] as unknown as string
    expect(prompt).toContain('proj-a')
    expect(prompt).toContain('/cfg/notion-integration.json')
  })
})
