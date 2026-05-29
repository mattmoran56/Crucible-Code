import type { Meta, StoryObj } from '@storybook/react'
import { useEffect } from 'react'
import { NotionIntegrationSettings } from './NotionIntegrationSettings'
import { resetStores, setupStoresForStory } from '../../stories/helpers/storeSetup'
import { useProjectStore } from '../../stores/projectStore'
import { useNotionStore, DEFAULT_NOTION_CONFIG } from '../../stores/notionStore'
import type { NotionIntegrationConfig } from '../../../shared/types'

interface SetupOptions {
  /** Per-project config to seed before render. */
  configs?: Record<string, NotionIntegrationConfig>
  /** Expanded "Configure" panel for the first project (default: false). */
  expandFirstProject?: boolean
  /** Preload the schema for proj-1 so dropdowns are populated. */
  preloadSchema?: boolean
  /** Click the "Set up automatically via Notion MCP" disclosure after expand. */
  expandMcpBlock?: boolean
}

const sampleSchema = {
  id: 'mock-db',
  title: 'Crucible Tasks',
  titlePropertyName: 'Task',
  properties: [
    { name: 'Task', type: 'title' },
    {
      name: 'Status',
      type: 'status',
      options: [
        { id: 'ready', name: 'Ready', color: 'green' },
        { id: 'in_progress', name: 'In Progress', color: 'blue' },
        { id: 'done', name: 'Done', color: 'gray' },
      ],
    },
    { name: 'Crucible Branch', type: 'url' },
    { name: 'Priority', type: 'select', options: [{ id: 'p1', name: 'High' }, { id: 'p2', name: 'Low' }] },
  ],
}

function Wrapper({ setup }: { setup?: SetupOptions }) {
  useEffect(() => {
    resetStores()
    setupStoresForStory()

    // Seed the Notion store directly so each story starts with predictable state.
    useNotionStore.setState({
      configByProject: setup?.configs ?? {},
      schemaByProject: setup?.preloadSchema ? { 'proj-1': sampleSchema as any } : {},
      loadingProjects: new Set(),
      configPath: '/Users/dev/Library/Application Support/Crucible Code/dev/notion-integration.json',
    })

    // The settings UI calls window.api.notion on mount (load + configPath). Stub
    // those out so it doesn't error in Storybook.
    const api = (window as any).api ?? {}
    ;(window as any).api = {
      ...api,
      notion: {
        ...(api.notion ?? {}),
        loadConfig: async (projectId: string) =>
          setup?.configs?.[projectId] ?? null,
        saveConfig: async () => {},
        testConnection: async () => ({ ok: true, taskCount: 3 }),
        getDatabaseSchema: async () => sampleSchema,
        applyWriteBack: async () => {},
        clearPickedUp: async () => {},
        getConfigPath: async () =>
          '/Users/dev/Library/Application Support/Crucible Code/dev/notion-integration.json',
        onFireTask: () => () => {},
      },
    }

    if (setup?.expandFirstProject) {
      // Click the first project card's "Configure" button once it's rendered,
      // then optionally drill into the "Set up automatically via Notion MCP"
      // disclosure so the copy-prompt buttons are visible in the screenshot.
      const t = window.setTimeout(() => {
        const buttons = Array.from(document.querySelectorAll('button')) as HTMLButtonElement[]
        const configureButton = buttons.find((b) => b.textContent?.trim() === 'Configure')
        configureButton?.click()
        if (setup.expandMcpBlock) {
          window.setTimeout(() => {
            const allButtons = Array.from(document.querySelectorAll('button')) as HTMLButtonElement[]
            const mcpButton = allButtons.find((b) =>
              (b.textContent ?? '').includes('Set up automatically via Notion MCP')
            )
            mcpButton?.click()
          }, 40)
        }
      }, 80)
      return () => window.clearTimeout(t)
    }
  }, [setup])

  const projects = useProjectStore((s) => s.projects)
  return (
    <div style={{ maxWidth: 720, padding: 24, background: 'var(--color-bg)' }}>
      <NotionIntegrationSettings projects={projects} />
    </div>
  )
}

const meta: Meta<typeof NotionIntegrationSettings> = {
  title: 'Settings/NotionIntegrationSettings',
  component: NotionIntegrationSettings,
  parameters: { layout: 'fullscreen' },
}
export default meta

type Story = StoryObj<typeof NotionIntegrationSettings>

export const Empty: Story = {
  render: () => <Wrapper />,
}

const configuredConfig: NotionIntegrationConfig = {
  ...DEFAULT_NOTION_CONFIG,
  enabled: true,
  apiToken: 'secret_••••••••••••••••••••',
  databaseId: '1234567890abcdef1234567890abcdef',
  filters: [
    { property: 'Status', type: 'status', operator: 'equals', value: 'Ready' },
  ],
  pickupUpdates: [
    { property: 'Status', type: 'status', value: 'In Progress' },
    { property: 'Crucible Branch', type: 'url', value: 'https://github.com/acme/repo/tree/{{branch}}' },
  ],
  startupPromptTemplate: '/notion-ticket {{taskUrl}}',
  branchNameTemplate: 'notion/{{taskTitleSlug}}',
  titlePropertyName: 'Task',
}

export const Configured: Story = {
  render: () => (
    <Wrapper
      setup={{
        configs: { 'proj-1': configuredConfig },
        expandFirstProject: true,
        preloadSchema: true,
      }}
    />
  ),
}

const multiGroupConfig: NotionIntegrationConfig = {
  ...configuredConfig,
  filters: [],
  filterGroups: [
    [
      { property: 'Status', type: 'status', operator: 'equals', value: 'Ready' },
      { property: 'Priority', type: 'select', operator: 'equals', value: 'High' },
    ],
    [
      { property: 'Status', type: 'status', operator: 'equals', value: 'Ready' },
      { property: 'Priority', type: 'select', operator: 'equals', value: 'Low' },
    ],
  ],
}

export const MultipleGroups: Story = {
  render: () => (
    <Wrapper
      setup={{
        configs: { 'proj-1': multiGroupConfig },
        expandFirstProject: true,
        preloadSchema: true,
      }}
    />
  ),
}

export const McpPromptOpen: Story = {
  render: () => (
    <Wrapper
      setup={{
        configs: { 'proj-1': configuredConfig },
        expandFirstProject: true,
        preloadSchema: true,
        expandMcpBlock: true,
      }}
    />
  ),
}
