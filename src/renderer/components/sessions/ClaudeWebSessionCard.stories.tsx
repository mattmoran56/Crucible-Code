import type { Meta, StoryObj } from '@storybook/react'
import { ClaudeWebSessionCard } from './ClaudeWebSessionCard'
import type { PullRequest } from '../../../shared/types'

const baseSession = {
  branchName: 'claude/zen-mendeleev',
  headSha: 'deadbeef',
  lastCommitDate: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  authorName: 'Matt',
}

const basePR: PullRequest = {
  number: 142,
  title: 'Add session-tagged worktree management',
  headRefName: 'claude/zen-mendeleev',
  baseRefName: 'main',
  author: 'mattmoran',
  assignees: ['mattmoran'],
  requestedReviewers: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  isDraft: false,
  state: 'OPEN',
  ciStatus: 'success',
  labels: [],
  commentsCount: 0,
  reviews: [],
}

const noop = () => {}

const meta: Meta<typeof ClaudeWebSessionCard> = {
  title: 'Sessions/ClaudeWebSessionCard',
  component: ClaudeWebSessionCard,
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div style={{ width: 260, background: 'var(--color-bg-secondary)' }}>
        <Story />
      </div>
    ),
  ],
  args: {
    session: baseSession,
    opening: false,
    onOpen: noop,
  },
}
export default meta

type Story = StoryObj<typeof ClaudeWebSessionCard>

export const Default: Story = {}

export const Opening: Story = {
  args: { opening: true },
}

export const WithOpenPR: Story = {
  args: { pr: basePR },
}

export const WithDraftPR: Story = {
  args: { pr: { ...basePR, isDraft: true, title: 'WIP: starting' } },
}

export const RecentCommit: Story = {
  args: {
    session: {
      ...baseSession,
      lastCommitDate: new Date(Date.now() - 90 * 1000).toISOString(),
    },
  },
}

export const OldCommit: Story = {
  args: {
    session: {
      ...baseSession,
      lastCommitDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    },
  },
}
