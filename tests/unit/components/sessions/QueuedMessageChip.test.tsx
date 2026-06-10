import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueuedMessageChip } from '../../../../src/renderer/components/sessions/QueuedMessageChip'
import { useSchedulerStore } from '../../../../src/renderer/stores/schedulerStore'
import { useSessionStore } from '../../../../src/renderer/stores/sessionStore'
import {
  formatClockTime,
  formatRelativeUntil,
} from '../../../../src/renderer/lib/scheduleTime'
import type { QueuedMessage } from '../../../../src/shared/types'

const IN_FIVE_MINUTES = Date.now() + 5 * 60_000

function makeMessage(overrides: Partial<QueuedMessage> = {}): QueuedMessage {
  return {
    id: 'qm-1',
    sessionId: 's1',
    message: 'continue',
    scheduledFor: IN_FIVE_MINUTES,
    createdAt: new Date().toISOString(),
    reason: 'usage-reset',
    ...overrides,
  }
}

describe('QueuedMessageChip', () => {
  let cancelQueuedMessage: ReturnType<typeof vi.fn>

  beforeEach(() => {
    cancelQueuedMessage = vi.fn().mockResolvedValue([])
    ;(window as any).api = {
      scheduler: { cancelQueuedMessage },
    }
    useSessionStore.setState({ activeSessionId: 's1' })
    useSchedulerStore.setState({ queuedMessages: [makeMessage()] })
  })

  it('renders nothing when there is no active session', () => {
    useSessionStore.setState({ activeSessionId: null })
    const { container } = render(<QueuedMessageChip />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when the active session has no queued message', () => {
    useSchedulerStore.setState({ queuedMessages: [makeMessage({ sessionId: 'other' })] })
    const { container } = render(<QueuedMessageChip />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders a status chip when a message is queued for the active session', () => {
    render(<QueuedMessageChip />)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('shows the queued message text', () => {
    useSchedulerStore.setState({ queuedMessages: [makeMessage({ message: 'run the tests' })] })
    render(<QueuedMessageChip />)
    expect(screen.getByText('run the tests')).toBeInTheDocument()
  })

  it('shows the absolute clock time of the scheduled send', () => {
    render(<QueuedMessageChip />)
    expect(
      screen.getByText(new RegExp(`for ${formatClockTime(IN_FIVE_MINUTES).replace(/\s/g, '\\s')}`))
    ).toBeInTheDocument()
  })

  it('shows the relative countdown', () => {
    render(<QueuedMessageChip />)
    // 5 minutes out -> "in 5m"
    expect(formatRelativeUntil(IN_FIVE_MINUTES)).toBe('in 5m')
    expect(screen.getByText(/in 5m/)).toBeInTheDocument()
  })

  it('exposes an accessible cancel button', () => {
    render(<QueuedMessageChip />)
    expect(screen.getByRole('button', { name: 'Cancel queued message' })).toBeInTheDocument()
  })

  it('clicking cancel calls the scheduler api with the message id', async () => {
    const user = userEvent.setup()
    render(<QueuedMessageChip />)
    await user.click(screen.getByRole('button', { name: 'Cancel queued message' }))
    expect(cancelQueuedMessage).toHaveBeenCalledWith('qm-1')
  })

  it('the chip disappears after cancelling updates the store', async () => {
    const user = userEvent.setup()
    render(<QueuedMessageChip />)
    await user.click(screen.getByRole('button', { name: 'Cancel queued message' }))
    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })
  })

  it('shows only the message belonging to the active session', () => {
    useSchedulerStore.setState({
      queuedMessages: [
        makeMessage({ id: 'qm-other', sessionId: 'other', message: 'other text' }),
        makeMessage({ id: 'qm-mine', sessionId: 's1', message: 'mine text' }),
      ],
    })
    render(<QueuedMessageChip />)
    expect(screen.getByText('mine text')).toBeInTheDocument()
    expect(screen.queryByText('other text')).not.toBeInTheDocument()
  })

  it('reacts to the active session changing', () => {
    useSchedulerStore.setState({
      queuedMessages: [makeMessage({ sessionId: 's2', message: 'for session two' })],
    })
    const { container } = render(<QueuedMessageChip />)
    expect(container).toBeEmptyDOMElement()
    act(() => {
      useSessionStore.setState({ activeSessionId: 's2' })
    })
    expect(screen.getByText('for session two')).toBeInTheDocument()
  })
})
