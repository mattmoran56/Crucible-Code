import type { Meta, StoryObj } from '@storybook/react'
import { useEffect } from 'react'
import { PRListDisplaySettings } from './PRListDisplaySettings'
import { resetStores, setupStoresForStory } from '../../stories/helpers/storeSetup'
import { useProjectStore } from '../../stores/projectStore'
import { usePRListDisplayStore } from '../../stores/prListDisplayStore'
import { DEFAULT_PR_LIST_DISPLAY } from '../../../shared/prDisplay'
import type { PRLabel } from '../../../shared/types'

interface SetupOptions {
  customizeFirstProject?: boolean
  expandFirstProject?: boolean
  enableLabelsOnFirstProject?: boolean
  preloadLabels?: boolean
}

function Wrapper({ setup }: { setup?: SetupOptions }) {
  useEffect(() => {
    resetStores()
    setupStoresForStory()
    // Clear any persisted display config so each story starts clean
    usePRListDisplayStore.setState({
      default: DEFAULT_PR_LIST_DISPLAY,
      byRepo: {},
    })

    if (setup?.customizeFirstProject) {
      const projects = useProjectStore.getState().projects
      const repoPath = projects[0]?.repoPath
      if (repoPath) {
        usePRListDisplayStore.getState().setForRepo(repoPath, {
          fields: {
            ...DEFAULT_PR_LIST_DISPLAY.fields,
            labels: setup.enableLabelsOnFirstProject ?? false,
            requestedReviewers: true,
            updatedAt: true,
          },
          labelFilter: setup.enableLabelsOnFirstProject
            ? { mode: 'only', names: ['bug', 'enhancement'] }
            : { mode: 'all' },
        })
      }
    }

    // Mock the IPC for label loading so the stories don't error in Storybook.
    if (setup?.preloadLabels) {
      const labels: PRLabel[] = [
        { name: 'bug', color: 'd73a4a' },
        { name: 'enhancement', color: 'a2eeef' },
        { name: 'documentation', color: '0075ca' },
        { name: 'good first issue', color: '7057ff' },
        { name: 'help wanted', color: '008672' },
      ]
      const api = (window as any).api ?? {}
      ;(window as any).api = {
        ...api,
        github: {
          ...(api.github ?? {}),
          listRepoLabels: async () => labels,
        },
      }
    }

    if (setup?.expandFirstProject) {
      // Click the first project's "Edit" toggle once mounted.
      const t = window.setTimeout(() => {
        const buttons = Array.from(document.querySelectorAll('button')) as HTMLButtonElement[]
        const editButtons = buttons.filter((b) => b.textContent?.trim() === 'Edit')
        // index 1 = first project (index 0 = the Default card)
        editButtons[1]?.click()
      }, 50)
      return () => window.clearTimeout(t)
    }
  }, [setup])

  const projects = useProjectStore((s) => s.projects)
  return (
    <div style={{ maxWidth: 640, padding: 24, background: 'var(--color-bg)' }}>
      <PRListDisplaySettings projects={projects} />
    </div>
  )
}

const meta: Meta<typeof PRListDisplaySettings> = {
  title: 'Settings/PRListDisplaySettings',
  component: PRListDisplaySettings,
  parameters: { layout: 'fullscreen' },
}
export default meta

type Story = StoryObj<typeof PRListDisplaySettings>

export const Empty: Story = {
  render: () => <Wrapper />,
}

export const OneCustomized: Story = {
  render: () => <Wrapper setup={{ customizeFirstProject: true }} />,
}

export const LabelPickerOpen: Story = {
  render: () => (
    <Wrapper
      setup={{
        customizeFirstProject: true,
        enableLabelsOnFirstProject: true,
        expandFirstProject: true,
        preloadLabels: true,
      }}
    />
  ),
}
