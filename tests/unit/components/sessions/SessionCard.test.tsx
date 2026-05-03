import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SessionCard } from '../../../../src/renderer/components/sessions/SessionCard'

const session = {
  id: 's1',
  name: 'feat/x',
  branchName: 'session/feat-x',
  worktreePath: '/wt',
  projectId: 'p1',
  createdAt: 'now',
  lastActiveAt: 'now',
} as any

const baseProps = {
  session,
  isActive: false,
  isOpenedAsMain: false,
  status: null,
  pr: undefined,
  onClick: () => {},
  onOpenAsMainBranch: () => {},
  onMarkStale: () => {},
  onDelete: () => {},
} as const

describe('SessionCard', () => {
  it('renders the session name and branch', () => {
    render(<SessionCard {...baseProps} />)
    expect(screen.getByText('feat/x')).toBeInTheDocument()
    expect(screen.getByText('session/feat-x')).toBeInTheDocument()
  })

  it('clicking the row fires onClick', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<SessionCard {...baseProps} onClick={onClick} />)
    await user.click(screen.getByText('feat/x'))
    expect(onClick).toHaveBeenCalled()
  })

  it('shows an "Open" badge when opened as main branch', () => {
    render(<SessionCard {...baseProps} isOpenedAsMain />)
    expect(screen.getByText('Open')).toBeInTheDocument()
  })

  it('PR information renders when a PR is attached', () => {
    render(
      <SessionCard
        {...baseProps}
        pr={{
          number: 42,
          title: 'Add foo',
          state: 'OPEN',
          isDraft: false,
          ciStatus: 'success',
          headRefName: 'session/feat-x',
        } as any}
      />
    )
    expect(screen.getByText(/#42 Add foo/)).toBeInTheDocument()
  })

  it('"Mark as stale" menu item triggers onMarkStale', async () => {
    const user = userEvent.setup()
    const onMarkStale = vi.fn()
    render(<SessionCard {...baseProps} onMarkStale={onMarkStale} />)
    await user.click(screen.getByRole('button', { name: /Actions for feat\/x/ }))
    await user.click(screen.getByRole('menuitem', { name: 'Mark as stale' }))
    expect(onMarkStale).toHaveBeenCalled()
  })

  it('Delete shows a confirmation dialog and only fires onDelete after confirming', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    render(<SessionCard {...baseProps} onDelete={onDelete} />)
    await user.click(screen.getByRole('button', { name: /Actions for feat\/x/ }))
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
    // Confirm dialog appears
    expect(screen.getByRole('dialog', { name: 'Delete session?' })).toBeInTheDocument()
    expect(onDelete).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onDelete).toHaveBeenCalled()
  })
})
