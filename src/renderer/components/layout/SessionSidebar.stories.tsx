import type { Meta, StoryObj } from '@storybook/react'
import { SessionSidebar } from './SessionSidebar'
import { setupStoresForStory, resetStores } from '../../stories/helpers/storeSetup'

const meta: Meta<typeof SessionSidebar> = {
  title: 'Layout/SessionSidebar',
  component: SessionSidebar,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => {
      resetStores()
      setupStoresForStory()
      return (
        <div style={{ height: '600px', width: 224, background: 'var(--color-bg-secondary)' }}>
          <Story />
        </div>
      )
    },
  ],
}
export default meta

type Story = StoryObj<typeof SessionSidebar>

export const Default: Story = {}
