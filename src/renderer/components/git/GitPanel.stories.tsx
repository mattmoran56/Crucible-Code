import type { Meta, StoryObj } from '@storybook/react'
import { GitPanel } from './GitPanel'
import { setupStoresForStory, resetStores } from '../../stories/helpers/storeSetup'

const meta: Meta<typeof GitPanel> = {
  title: 'Git/GitPanel',
  component: GitPanel,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => {
      resetStores()
      setupStoresForStory({ activeWorkspaceTab: 'git' })
      return (
        <div style={{ height: '600px', display: 'flex', background: 'var(--color-bg)' }}>
          <Story />
        </div>
      )
    },
  ],
}
export default meta

type Story = StoryObj<typeof GitPanel>

export const Default: Story = {}
