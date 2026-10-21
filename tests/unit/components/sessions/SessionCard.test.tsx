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

  it('shows a Cloud indicator for cloud sessions', () => {
    render(
      <SessionCard
        {...baseProps}
        session={{ ...session, location: 'cloud', cloud: { sessionId: 'cs1', url: 'https://claude.ai/code/cs1' } }}
      />
    )
    const badge = screen.getByTitle('Running in Claude Code on the web')
    expect(badge).toHaveTextContent('Cloud')
  })

  it('does not show the Cloud indicator for local sessions', () => {
    const { rerender } = render(<SessionCard {...baseProps} />)
    expect(screen.queryByTitle('Running in Claude Code on the web')).not.toBeInTheDocument()
    rerender(<SessionCard {...baseProps} session={{ ...session, location: 'local' }} />)
    expect(screen.queryByTitle('Running in Claude Code on the web')).not.toBeInTheDocument()
    expect(screen.queryByText('Cloud')).not.toBeInTheDocument()
  })

  it('delete confirm offers no remote-branch option for a local session', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    render(<SessionCard {...baseProps} onDelete={onDelete} />)
    await user.click(screen.getByRole('button', { name: /Actions for feat\/x/ }))
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
    expect(screen.getByText(/remove the worktree and local branch/)).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onDelete).toHaveBeenCalledWith(undefined)
  })

  it('delete confirm for a cloud session can also delete the remote branch (off by default)', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    const cloudSession = {
      ...session,
      location: 'cloud',
      cloud: { sessionId: 'session_1', url: 'u', branch: 'session/feat-x' },
    }
    render(<SessionCard {...baseProps} session={cloudSession} onDelete={onDelete} />)
    await user.click(screen.getByRole('button', { name: /Actions for feat\/x/ }))
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
    const box = screen.getByRole('checkbox', { name: 'Also delete the remote branch origin/session/feat-x' })
    expect(box).not.toBeChecked()
    await user.click(box)
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onDelete).toHaveBeenCalledWith({ deleteRemoteBranch: true })
  })

  it('delete confirm for a cloud session leaves the remote branch when unchecked', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    const cloudSession = { ...session, cloud: { sessionId: 'session_1', url: 'u' } }
    render(<SessionCard {...baseProps} session={cloudSession} onDelete={onDelete} />)
    await user.click(screen.getByRole('button', { name: /Actions for feat\/x/ }))
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
    expect(screen.getByRole('checkbox', { name: /origin\/session\/feat-x/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onDelete).toHaveBeenCalledWith(undefined)
  })

  it('delete confirm does not promise to delete a branch the app did not create', async () => {
    const user = userEvent.setup()
    render(<SessionCard {...baseProps} session={{ ...session, branchName: 'feature/theirs' }} />)
    await user.click(screen.getByRole('button', { name: /Actions for feat\/x/ }))
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
    expect(screen.getByText(/remove the worktree for/)).toBeInTheDocument()
  })
})
