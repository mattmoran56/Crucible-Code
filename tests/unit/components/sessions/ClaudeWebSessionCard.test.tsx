import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  ClaudeWebSessionCard,
  ClaudeWebSessionCardContainer,
} from '../../../../src/renderer/components/sessions/ClaudeWebSessionCard'
import { useToastStore } from '../../../../src/renderer/stores/toastStore'

const session = {
  branchName: 'claude/zen-mendeleev',
  headSha: 'deadbeef',
  lastCommitDate: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  authorName: 'Matt',
}

describe('ClaudeWebSessionCard', () => {
  it('renders the branch name and a relative time', () => {
    render(
      <ClaudeWebSessionCard session={session} opening={false} onOpen={() => {}} />
    )
    expect(screen.getByText('claude/zen-mendeleev')).toBeInTheDocument()
    expect(screen.getByText(/2h ago|1h ago/)).toBeInTheDocument()
  })

  it('clicking the row fires onOpen', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    render(<ClaudeWebSessionCard session={session} opening={false} onOpen={onOpen} />)
    await user.click(screen.getByRole('button'))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('Enter key fires onOpen', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    render(<ClaudeWebSessionCard session={session} opening={false} onOpen={onOpen} />)
    screen.getByRole('button').focus()
    await user.keyboard('{Enter}')
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('does not fire onOpen while already opening', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    render(<ClaudeWebSessionCard session={session} opening={true} onOpen={onOpen} />)
    await user.click(screen.getByRole('button'))
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('shows a draft PR badge when the PR is draft', () => {
    render(
      <ClaudeWebSessionCard
        session={session}
        opening={false}
        onOpen={() => {}}
        pr={{
          number: 7,
          title: 'WIP',
          isDraft: true,
          state: 'OPEN',
          headRefName: 'claude/zen-mendeleev',
        } as any}
      />
    )
    expect(screen.getByText(/#7 WIP/)).toBeInTheDocument()
    expect(screen.getByTitle('Draft PR')).toBeInTheDocument()
  })

  it('shows an open PR badge when the PR is open and not draft', () => {
    render(
      <ClaudeWebSessionCard
        session={session}
        opening={false}
        onOpen={() => {}}
        pr={{
          number: 8,
          title: 'Ship it',
          isDraft: false,
          state: 'OPEN',
          headRefName: 'claude/zen-mendeleev',
        } as any}
      />
    )
    expect(screen.getByText(/#8 Ship it/)).toBeInTheDocument()
    expect(screen.getByTitle('Open PR')).toBeInTheDocument()
  })
})

describe('ClaudeWebSessionCardContainer', () => {
  it('shows a toast when the open handler throws', async () => {
    const user = userEvent.setup()
    useToastStore.setState({ toasts: [] })
    const onOpen = vi.fn(async () => {
      throw new Error('git worktree add failed: branch already in use')
    })
    render(<ClaudeWebSessionCardContainer session={session} onOpen={onOpen} />)
    await user.click(screen.getByRole('button'))
    const toasts = useToastStore.getState().toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0].type).toBe('error')
    expect(toasts[0].message).toMatch(/Failed to open claude\/zen-mendeleev/)
    expect(toasts[0].message).toMatch(/branch already in use/)
  })

  it('does not toast when the open handler succeeds', async () => {
    const user = userEvent.setup()
    useToastStore.setState({ toasts: [] })
    const onOpen = vi.fn(async () => {})
    render(<ClaudeWebSessionCardContainer session={session} onOpen={onOpen} />)
    await user.click(screen.getByRole('button'))
    expect(useToastStore.getState().toasts).toHaveLength(0)
    expect(onOpen).toHaveBeenCalled()
  })
})
