import type { Meta, StoryObj } from '@storybook/react'
import { ReviewersSection } from './ReviewersSection'
import type { PRDetail, GitHubCollaborator } from '../../../shared/types'

const baseDetail: PRDetail = {
  body: '',
  author: 'mattmoran56',
  title: 'Improve PR review',
  createdAt: new Date().toISOString(),
  baseRefName: 'main',
  headRefName: 'feat/better-pr-review',
  requestedReviewers: [],
  reviews: [],
}

const collaborators: GitHubCollaborator[] = [
  { login: 'alice' },
  { login: 'bob' },
  { login: 'carol' },
  { login: 'dave' },
]

const meta: Meta<typeof ReviewersSection> = {
  title: 'PR/ReviewersSection',
  component: ReviewersSection,
  parameters: { layout: 'centered' },
  decorators: [(Story) => <div style={{ width: 480 }}><Story /></div>],
}
export default meta

type Story = StoryObj<typeof ReviewersSection>

export const Empty: Story = {
  args: {
    detail: baseDetail,
    collaborators,
    onAddReviewer: (login) => console.log('add', login),
    onRemoveReviewer: (login) => console.log('remove', login),
  },
}

export const MixedStates: Story = {
  args: {
    detail: {
      ...baseDetail,
      requestedReviewers: ['carol', 'dave'],
      reviews: [
        { author: 'alice', state: 'APPROVED', submittedAt: new Date().toISOString() },
        { author: 'bob', state: 'CHANGES_REQUESTED', submittedAt: new Date().toISOString() },
      ],
    },
    collaborators,
    onAddReviewer: (login) => console.log('add', login),
    onRemoveReviewer: (login) => console.log('remove', login),
  },
}

export const ApprovalsOnly: Story = {
  args: {
    detail: {
      ...baseDetail,
      reviews: [
        { author: 'alice', state: 'APPROVED', submittedAt: new Date().toISOString() },
        { author: 'bob', state: 'APPROVED', submittedAt: new Date().toISOString() },
      ],
    },
    collaborators,
    onAddReviewer: (login) => console.log('add', login),
    onRemoveReviewer: (login) => console.log('remove', login),
  },
}

export const PendingOnly: Story = {
  args: {
    detail: {
      ...baseDetail,
      requestedReviewers: ['alice', 'bob'],
    },
    collaborators,
    onAddReviewer: (login) => console.log('add', login),
    onRemoveReviewer: (login) => console.log('remove', login),
  },
}
