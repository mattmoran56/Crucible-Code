import type { Meta, StoryObj } from '@storybook/react'
import { InlineThread } from './InlineThread'
import type { PRReviewThread } from '../../../shared/types'

const now = new Date().toISOString()

const baseThread: PRReviewThread = {
  id: 'PRRT_thread_1',
  path: 'src/foo.ts',
  line: 42,
  startLine: null,
  side: 'RIGHT',
  isResolved: false,
  rootCommentId: 1,
  comments: [
    {
      id: 1,
      body: 'Should this be `Number()` instead of `parseInt()` here? `parseInt` silently drops trailing characters.',
      path: 'src/foo.ts',
      line: 42,
      side: 'RIGHT',
      author: 'alice',
      createdAt: now,
    },
    {
      id: 2,
      body: 'Good call — switching to `Number()`.',
      path: 'src/foo.ts',
      line: 42,
      side: 'RIGHT',
      author: 'bob',
      createdAt: now,
      inReplyToId: 1,
    },
  ],
}

const meta: Meta<typeof InlineThread> = {
  title: 'PR/InlineThread',
  component: InlineThread,
  parameters: { layout: 'centered' },
  decorators: [(Story) => <div style={{ width: 640 }} className="bg-bg"><Story /></div>],
}
export default meta

type Story = StoryObj<typeof InlineThread>

export const Open: Story = {
  args: {
    thread: baseThread,
    onReply: async () => {},
    onResolve: async () => {},
    onUnresolve: async () => {},
  },
}

export const Resolved: Story = {
  args: {
    thread: { ...baseThread, isResolved: true },
    onReply: async () => {},
    onResolve: async () => {},
    onUnresolve: async () => {},
  },
}

export const WithSuggestion: Story = {
  args: {
    thread: {
      ...baseThread,
      comments: [
        {
          id: 10,
          body: 'Try this:\n\n```suggestion\nconst total = Number(rawValue)\n```',
          path: 'src/foo.ts',
          line: 42,
          side: 'RIGHT',
          author: 'alice',
          createdAt: now,
        },
      ],
    },
    onReply: async () => {},
    onResolve: async () => {},
    onUnresolve: async () => {},
    onApplySuggestion: async () => {},
  },
}
