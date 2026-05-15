import type { Meta, StoryObj } from '@storybook/react'
import { useEffect } from 'react'
import { PRConversationTab } from './PRConversationTab'
import { resetStores, setupStoresForStory } from '../../stories/helpers/storeSetup'
import { usePRReviewStore } from '../../stores/prReviewStore'
import { mockPRReviewThreads } from '@mock/mockData'
import type { PRReviewThread } from '../../../shared/types'

function Wrapper({ prepare }: { prepare?: () => void }) {
  useEffect(() => {
    resetStores()
    setupStoresForStory({ activePRNumber: 123 })
    prepare?.()
  }, [prepare])

  return (
    <div className="bg-bg text-text" style={{ width: 720, height: 720, display: 'flex', flexDirection: 'column' }}>
      <PRConversationTab />
    </div>
  )
}

const meta: Meta<typeof Wrapper> = {
  title: 'PR/PRConversationTab',
  component: Wrapper,
  parameters: { layout: 'centered' },
}
export default meta

type Story = StoryObj<typeof Wrapper>

/** Conversation tab with review threads grouped by file alongside issue comments. */
export const WithReviewThreads: Story = {
  args: {},
}

/** Only unresolved threads — verifies the unresolved counter in the header. */
export const OnlyUnresolved: Story = {
  args: {
    prepare: () => {
      usePRReviewStore.setState({
        reviewThreads: (mockPRReviewThreads as PRReviewThread[]).map((t) => ({ ...t, isResolved: false })),
      })
    },
  },
}

/** All threads resolved — they collapse to single-line summaries. */
export const AllResolved: Story = {
  args: {
    prepare: () => {
      usePRReviewStore.setState({
        reviewThreads: (mockPRReviewThreads as PRReviewThread[]).map((t) => ({ ...t, isResolved: true })),
      })
    },
  },
}

/** No review comments at all — empty-state copy shows only when issue comments are also empty. */
export const NoReviewComments: Story = {
  args: {
    prepare: () => {
      usePRReviewStore.setState({ reviewThreads: [], conversationComments: [] })
    },
  },
}
