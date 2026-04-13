import type { Meta, StoryObj } from '@storybook/react'
import { SessionCard } from './SessionCard'

const baseSession = {
  id: 'sess-1',
  name: 'add-pr-review',
  branchName: 'session/add-pr-review',
  worktreePath: '/mock/worktree',
  projectId: 'proj-1',
  createdAt: new Date().toISOString(),
  lastActiveAt: new Date().toISOString(),
  baseBranch: 'main',
}

const basePR = {
  number: 42,
  title: 'Add PR review panel with conversation and checks',
  headRefName: 'session/add-pr-review',
  baseRefName: 'main',
  author: 'alice',
  updatedAt: new Date().toISOString(),
  isDraft: false,
}

const noop = () => {}

const meta: Meta<typeof SessionCard> = {
  title: 'Sessions/SessionCard',
  component: SessionCard,
  parameters: { layout: 'centered' },
  decorators: [(Story) => <div style={{ width: 224, background: 'var(--color-bg-secondary)' }}><Story /></div>],
  args: {
    session: baseSession,
    isActive: false,
    isOpenedAsMain: false,
    status: null,
    onClick: noop,
    onOpenAsMainBranch: noop,
    onMarkStale: noop,
    onDelete: noop,
  },
}
export default meta

type Story = StoryObj<typeof SessionCard>

export const Default: Story = {}

export const Active: Story = {
  args: { isActive: true },
}

export const Running: Story = {
  args: { status: 'running' },
}

export const Attention: Story = {
  args: { status: 'attention' },
}

export const Completed: Story = {
  args: { status: 'completed' },
}

export const WithPR: Story = {
  args: { isActive: true, pr: basePR, status: 'running' },
}

export const WithDraftPR: Story = {
  args: { pr: { ...basePR, isDraft: true, title: 'WIP: Add code editor' } },
}
