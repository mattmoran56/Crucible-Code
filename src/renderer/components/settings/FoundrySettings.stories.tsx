import type { Meta, StoryObj } from '@storybook/react'
import { useEffect, useState } from 'react'
import { FoundrySettings } from './FoundrySettings'
import { useFoundryStore } from '../../stores/foundryStore'
import { resetStores, setupStoresForStory } from '../../stories/helpers/storeSetup'
import { useProjectStore } from '../../stores/projectStore'
import type { FoundryConfig } from '../../../shared/types'

const projectId = 'proj-1'

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
        { id: 'ns', name: 'Not Started', color: 'gray' },
        { id: 'ip', name: 'In Progress', color: 'blue' },
        { id: 'rev', name: 'In review', color: 'purple' },
        { id: 'tst', name: 'Testing', color: 'orange' },
        { id: 'done', name: 'Done', color: 'green' },
      ],
    },
    {
      name: 'Project',
      type: 'relation',
      relationDatabaseId: '37581e6a-deaf-44b8-8f2e-cfa038c58bff',
    },
    {
      name: 'Priority',
      type: 'select',
      options: [
        { id: 'p1', name: 'High' },
        { id: 'p2', name: 'Medium' },
        { id: 'p3', name: 'Low' },
      ],
    },
  ],
}

const configuredConfig: FoundryConfig = {
  id: 'fnd-1',
  name: 'Simulation attempt tracking',
  projectId,
  enabled: false,
  taskSetFilters: [
    [
      {
        property: 'Project',
        type: 'relation',
        operator: 'equals',
        value: '376c9cf4-af01-807d-a8ad-cc83d4df8a06',
        relationDatabaseId: '37581e6a-deaf-44b8-8f2e-cfa038c58bff',
      },
    ],
  ],
  eligibilityFilters: [
    {
      property: 'Status',
      type: 'status',
      operator: 'equals',
      value: 'Not Started',
    },
  ],
  completionTransition: {
    property: 'Status',
    fromValue: 'In review',
    toValue: 'Testing',
  },
  completedStatuses: ['Done', 'Testing'],
  optimisticContinue: true,
  optimisticStatuses: ['In review'],
  pickupUpdates: [
    { property: 'Status', type: 'status', value: 'In Progress' },
  ],
  readyForReviewUpdates: [
    { property: 'Status', type: 'status', value: 'In review' },
  ],
  implementCommandTemplate: `/notion-ticket {{taskUrl}}

When the ticket is fully implemented:
1. Stage and commit all your changes with a clear message.
2. Push the branch to origin.
3. Open a DRAFT pull request against the base branch. The PR title should summarise the ticket; the PR body should include the Notion ticket URL and a short summary of what you changed.
4. Do not mark the PR ready for review yet, and do not update the Notion ticket status — the Foundry handles both once a separate review loop has converged.

If you are blocked or need a decision, say so clearly and stop without pushing.`,
  readyForReviewCommandTemplate: `Update the PR review checklist. Use ✓, ✗, and ⊘ — use ⊘ where the question is not applicable or we haven't touched that area. Add a short note only if absolutely necessary; otherwise leave blank. Note that we have reviewed with Claude Code, then mark the PR as ready for review.`,
  branchNameTemplate: 'foundry/{{taskTitleSlug}}',
  baseBranch: 'project/simulation-attempt-tracking',
  maxConcurrentTasks: 3,
  workerPermissionMode: 'default',
  triggerOnCompletedStatusEnter: true,
}

interface SetupOptions {
  configs: FoundryConfig[]
  /** Click the Edit button on the first foundry card before snapshot. */
  openEditor?: boolean
}

function Wrapper({ setup }: { setup: SetupOptions }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    resetStores()
    setupStoresForStory()

    // Stub the foundry api so the component's reload + save + delete don't crash.
    const api = (window as any).api ?? {}
    ;(window as any).api = {
      ...api,
      foundry: {
        ...(api.foundry ?? {}),
        list: async () => setup.configs,
        save: async () => setup.configs,
        delete: async () => [],
        setPaused: async () => {},
        runNow: async () => {},
        getState: async () => null,
        resetState: async () => ({ ok: true }),
      },
      notion: {
        ...(api.notion ?? {}),
        listRelationOptions: async () => [
          { id: '376c9cf4-af01-807d-a8ad-cc83d4df8a06', title: 'Simulation attempt tracking' },
          { id: '376c9cf4-af01-807d-a8ad-aaaaaaaaaaaa', title: 'Some other project' },
        ],
        listUsers: async () => [
          { id: '2e2d61ab-60c7-43eb-a94f-6ce6ddd97ead', name: 'You', avatarUrl: null },
        ],
        loadConfig: async () => ({
          enabled: true,
          apiToken: 'secret_••••••••••••',
          databaseId: '1234567890abcdef1234567890abcdef',
          filters: [],
          pickupUpdates: [],
          pickupAppendMarkdown: '',
          startupPromptTemplate: '/notion-ticket {{taskUrl}}',
          branchNameTemplate: 'notion/{{taskTitleSlug}}',
        }),
        getDatabaseSchema: async () => sampleSchema,
      },
    }

    useFoundryStore.setState({
      configs: setup.configs,
      states: {},
    })
    setReady(true)

    if (setup.openEditor) {
      // Click the first Edit button once it's rendered.
      const t = window.setTimeout(() => {
        const buttons = Array.from(document.querySelectorAll('button')) as HTMLButtonElement[]
        const editButton = buttons.find((b) => b.textContent?.trim() === 'Edit')
        editButton?.click()
      }, 200)
      return () => window.clearTimeout(t)
    }
  }, [setup])

  const projects = useProjectStore((s) => s.projects)
  if (!ready) return null
  return (
    <div style={{ maxWidth: 760, padding: 24, background: 'var(--color-bg)' }}>
      <FoundrySettings projects={projects} />
    </div>
  )
}

const meta: Meta<typeof FoundrySettings> = {
  title: 'Settings/FoundrySettings',
  component: FoundrySettings,
  parameters: { layout: 'fullscreen' },
}
export default meta
type Story = StoryObj<typeof FoundrySettings>

export const Configured: Story = {
  render: () => <Wrapper setup={{ configs: [configuredConfig] }} />,
}

export const Editor: Story = {
  render: () => (
    <Wrapper setup={{ configs: [configuredConfig], openEditor: true }} />
  ),
}
