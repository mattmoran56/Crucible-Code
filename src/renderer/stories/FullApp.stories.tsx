import type { Meta, StoryObj } from '@storybook/react'
import App from '../App'
import { setupStoresForStory, resetStores } from './helpers/storeSetup'

const meta: Meta<typeof App> = {
  title: 'App/Full Layout',
  component: App,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => {
      resetStores()
      return (
        <div style={{ height: '100vh', width: '100vw' }}>
          <Story />
        </div>
      )
    },
  ],
}
export default meta

type Story = StoryObj<typeof App>

export const Default: Story = {
  decorators: [
    (Story) => {
      setupStoresForStory()
      return <Story />
    },
  ],
}

export const GitView: Story = {
  decorators: [
    (Story) => {
      setupStoresForStory({ activeWorkspaceTab: 'git' })
      return <Story />
    },
  ],
}

export const PRReview: Story = {
  decorators: [
    (Story) => {
      setupStoresForStory({ activePRNumber: 42, activeWorkspaceTab: 'pr' })
      return <Story />
    },
  ],
}

export const EditorView: Story = {
  decorators: [
    (Story) => {
      setupStoresForStory({ editorMode: true })
      return <Story />
    },
  ],
}

export const Settings: Story = {
  decorators: [
    (Story) => {
      setupStoresForStory({ settingsOpen: true })
      return <Story />
    },
  ],
}

export const CustomButtons: Story = {
  decorators: [
    (Story) => {
      setupStoresForStory()
      return <Story />
    },
  ],
}

export const ButtonSettings: Story = {
  decorators: [
    (Story) => {
      setupStoresForStory({ settingsOpen: true })
      return <Story />
    },
  ],
}
