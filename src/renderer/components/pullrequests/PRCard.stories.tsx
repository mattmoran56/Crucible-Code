import type { Meta, StoryObj } from '@storybook/react'
import { PRCard } from './PRCard'
import { DEFAULT_PR_LIST_DISPLAY, type PRListDisplay } from '../../../shared/prDisplay'
import type { PullRequest } from '../../../shared/types'

const basePR: PullRequest = {
  number: 42,
  title: 'Add PR review panel with conversation and checks',
  headRefName: 'session/add-pr-review',
  baseRefName: 'main',
  author: 'alice',
  assignees: ['alice', 'bob'],
  requestedReviewers: ['carol', 'dave'],
  createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  isDraft: false,
  state: 'OPEN',
  ciStatus: 'success',
  labels: [
    { name: 'enhancement', color: 'a2eeef' },
    { name: 'needs-review', color: 'd4c5f9' },
    { name: 'frontend', color: '0e8a16' },
  ],
  commentsCount: 6,
  reviews: [
    { author: 'erin', state: 'APPROVED', submittedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() },
    { author: 'frank', state: 'CHANGES_REQUESTED', submittedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString() },
  ],
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        width: 280,
        background: 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border)',
        borderRadius: 6,
        overflow: 'hidden',
      }}
    >
      {children}
    </div>
  )
}

const meta: Meta<typeof PRCard> = {
  title: 'PR/PRCard',
  component: PRCard,
  parameters: { layout: 'centered' },
}
export default meta

type Story = StoryObj<typeof PRCard>

export const Default: Story = {
  render: () => (
    <Frame>
      <PRCard pr={basePR} isNew={false} isActive={false} onClick={() => {}} />
    </Frame>
  ),
}

export const LabelsOn: Story = {
  render: () => {
    const display: PRListDisplay = {
      ...DEFAULT_PR_LIST_DISPLAY,
      fields: { ...DEFAULT_PR_LIST_DISPLAY.fields, labels: true },
    }
    return (
      <Frame>
        <PRCard pr={basePR} isNew isActive={false} display={display} onClick={() => {}} />
      </Frame>
    )
  },
}

export const OnlyTwoLabels: Story = {
  render: () => {
    const display: PRListDisplay = {
      ...DEFAULT_PR_LIST_DISPLAY,
      fields: { ...DEFAULT_PR_LIST_DISPLAY.fields, labels: true },
      labelFilter: { mode: 'only', names: ['enhancement', 'frontend'] },
    }
    return (
      <Frame>
        <PRCard pr={basePR} isNew={false} isActive={false} display={display} onClick={() => {}} />
      </Frame>
    )
  },
}

export const AllFieldsOn: Story = {
  render: () => {
    const allOn = Object.fromEntries(
      Object.keys(DEFAULT_PR_LIST_DISPLAY.fields).map((k) => [k, true])
    ) as PRListDisplay['fields']
    const display: PRListDisplay = {
      fields: allOn,
      labelFilter: { mode: 'all' },
    }
    return (
      <Frame>
        <PRCard pr={basePR} isNew isActive={false} needsAttention display={display} onClick={() => {}} />
      </Frame>
    )
  },
}

export const Draft: Story = {
  render: () => (
    <Frame>
      <PRCard pr={{ ...basePR, isDraft: true, ciStatus: 'failure' }} isNew={false} isActive={false} onClick={() => {}} />
    </Frame>
  ),
}
