import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PRCard } from '../../../../src/renderer/components/pullrequests/PRCard'
import { DEFAULT_PR_LIST_DISPLAY } from '../../../../src/shared/prDisplay'

const basePR = {
  number: 42,
  title: 'Add PR review panel',
  headRefName: 'session/x',
  baseRefName: 'main',
  author: 'alice',
  assignees: ['alice'],
  requestedReviewers: ['carol'],
  createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  updatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  isDraft: false,
  state: 'OPEN',
  ciStatus: 'success',
  labels: [{ name: 'bug', color: 'ff0000' }],
  commentsCount: 3,
  reviews: [],
} as any

describe('PRCard', () => {
  it('renders the title and #number', () => {
    render(<PRCard pr={basePR} isNew={false} isActive={false} onClick={() => {}} />)
    expect(screen.getByText(/Add PR review panel/)).toBeInTheDocument()
    expect(screen.getByText(/#42/)).toBeInTheDocument()
  })

  it('renders the head→base branches', () => {
    render(<PRCard pr={basePR} isNew={false} isActive={false} onClick={() => {}} />)
    expect(screen.getByText(/session\/x/)).toBeInTheDocument()
    expect(screen.getByText(/main/)).toBeInTheDocument()
  })

  it('shows the CI passed indicator for ciStatus=success', () => {
    render(<PRCard pr={basePR} isNew={false} isActive={false} onClick={() => {}} />)
    expect(screen.getByLabelText('CI passed')).toBeInTheDocument()
  })

  it('shows attention badge when needsAttention is true', () => {
    render(<PRCard pr={basePR} isNew={false} isActive={false} needsAttention onClick={() => {}} />)
    expect(screen.getByLabelText('Agent waiting for attention')).toBeInTheDocument()
  })

  it('clicking the card calls onClick', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<PRCard pr={basePR} isNew={false} isActive={false} onClick={onClick} />)
    await user.click(screen.getByText(/Add PR review panel/))
    expect(onClick).toHaveBeenCalled()
  })

  it('hides labels when display.fields.labels is false', () => {
    render(
      <PRCard
        pr={basePR}
        isNew={false}
        isActive={false}
        onClick={() => {}}
        display={{ ...DEFAULT_PR_LIST_DISPLAY, fields: { ...DEFAULT_PR_LIST_DISPLAY.fields, labels: false } }}
      />
    )
    expect(screen.queryByText('bug')).not.toBeInTheDocument()
  })

  it('shows labels when display.fields.labels is true', () => {
    render(
      <PRCard
        pr={basePR}
        isNew={false}
        isActive={false}
        onClick={() => {}}
        display={{ ...DEFAULT_PR_LIST_DISPLAY, fields: { ...DEFAULT_PR_LIST_DISPLAY.fields, labels: true } }}
      />
    )
    expect(screen.getByText('bug')).toBeInTheDocument()
  })

  it('uses the merged dot for merged PRs', () => {
    render(
      <PRCard
        pr={{ ...basePR, state: 'MERGED' }}
        isNew={false}
        isActive={false}
        onClick={() => {}}
      />
    )
    expect(screen.getByTitle('Merged')).toBeInTheDocument()
  })

  it('uses the draft dot for drafts', () => {
    render(
      <PRCard
        pr={{ ...basePR, isDraft: true }}
        isNew={false}
        isActive={false}
        onClick={() => {}}
      />
    )
    expect(screen.getByTitle('Draft')).toBeInTheDocument()
  })
})
