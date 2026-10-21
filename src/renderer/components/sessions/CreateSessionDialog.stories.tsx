import React from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import type { Project } from '../../../shared/types'
import { useProjectStore } from '../../stores/projectStore'
import { useStartupPromptStore } from '../../stores/startupPromptStore'
import { useUsageStore } from '../../stores/usageStore'
import { CreateSessionDialog } from './CreateSessionDialog'

// The dialog loads branches and startup prompts through window.api (the
// Storybook mock bridge), so only the stores it reads directly are reset here.

const PROJECT: Project = {
  id: 'proj-1',
  name: 'CodeCrucible',
  repoPath: '/Users/dev/repos/CodeCrucible',
}

const meta: Meta<typeof CreateSessionDialog> = {
  title: 'Sessions/CreateSessionDialog',
  component: CreateSessionDialog,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => {
      useProjectStore.setState({ claudeAccounts: [] })
      useStartupPromptStore.setState({ byProject: {}, loadingProjects: new Set() })
      // No usage data, so nothing depends on the clock.
      useUsageStore.setState({ sessionUsages: {} })
      return (
        <div style={{ height: '100vh', width: '100vw' }} className="bg-bg">
          <Story />
        </div>
      )
    },
  ],
  args: { open: true, onClose: () => {} },
}
export default meta

type Story = StoryObj<typeof CreateSessionDialog>

/** Default for a project with no preference: Cloud, with the Task box. */
export const CloudDefault: Story = {
  args: { project: PROJECT },
}

/** A project whose default session location is Local. */
export const Local: Story = {
  args: { project: { ...PROJECT, defaultSessionLocation: 'local' } },
}
