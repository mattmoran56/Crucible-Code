import type { Meta, StoryObj } from '@storybook/react'
import { HandlePage } from './HandlePage'

// The HandlePage imports pairCloud from ../api/wsClient at module load. In a
// real receiver build that module sets up WebSocket state; for Storybook we
// only need the form to render and the submit handler to be a no-op. The
// real pairCloud throws if invoked without a backend, so this story just
// renders the page without actually submitting — the visual surface is the
// form, not the pair flow.

const meta: Meta<typeof HandlePage> = {
  title: 'Remote/HandlePage',
  component: HandlePage,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="h-screen w-screen bg-bg" data-theme="dark">
        <Story />
      </div>
    ),
  ],
}
export default meta

type Story = StoryObj<typeof HandlePage>

export const Default: Story = {
  args: {
    onPaired: () => {
      // No-op for the visual story. The Storybook actions addon will log
      // this call if the user submits the form.
      // eslint-disable-next-line no-console
      console.log('onPaired (storybook stub)')
    },
  },
}
