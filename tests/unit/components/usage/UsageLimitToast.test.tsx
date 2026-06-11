import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UsageLimitToast } from '../../../../src/renderer/components/usage/UsageLimitToast'
import { useSettingsStore } from '../../../../src/renderer/stores/settingsStore'
import { useSchedulerStore } from '../../../../src/renderer/stores/schedulerStore'
import { useSessionStore } from '../../../../src/renderer/stores/sessionStore'
import { useToastStore } from '../../../../src/renderer/stores/toastStore'
import { formatClockTime } from '../../../../src/renderer/lib/scheduleTime'
import type { QueuedMessage, UsageLimitEvent } from '../../../../src/shared/types'

const RESETS_AT = Math.floor(Date.now() / 1000) + 3600 // unix seconds, one hour out

let limitCallback: ((event: UsageLimitEvent) => void) | null
let unsubscribe: ReturnType<typeof vi.fn>
let addQueuedMessageApi: ReturnType<typeof vi.fn>

function emit(event: Partial<UsageLimitEvent> = {}) {
  act(() => {
    limitCallback?.({ sessionId: 's1', resetsAt: RESETS_AT, ...event })
  })
}

function expectedScheduledFor(delayMinutes: number) {
  return RESETS_AT * 1000 + delayMinutes * 60_000
}

beforeEach(() => {
  limitCallback = null
  unsubscribe = vi.fn()
  addQueuedMessageApi = vi.fn(async (item: QueuedMessage) => [item])
  ;(window as any).api = {
    usage: {
      onLimitReached: vi.fn((cb: (event: UsageLimitEvent) => void) => {
        limitCallback = cb
        return unsubscribe
      }),
    },
    scheduler: { addQueuedMessage: addQueuedMessageApi },
  }
  useSettingsStore.setState({ autoQueueContinue: false, usageResetDelayMinutes: 1 })
  useSchedulerStore.setState({ queuedMessages: [] })
  useSessionStore.setState({
    sessions: [{ id: 's1', name: 'My Session', branchName: 'b', worktreePath: '/wt', projectId: 'p1', createdAt: 'now' }] as any,
  })
  useToastStore.setState({ toasts: [] })
})

describe('UsageLimitToast', () => {
  it('renders nothing before any limit event arrives', () => {
    const { container } = render(<UsageLimitToast />)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('subscribes to usage limit events on mount', () => {
    render(<UsageLimitToast />)
    expect((window as any).api.usage.onLimitReached).toHaveBeenCalledTimes(1)
  })

  it('unsubscribes on unmount', () => {
    const { unmount } = render(<UsageLimitToast />)
    unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('opens the dialog when a limit event arrives', () => {
    render(<UsageLimitToast />)
    emit()
    expect(screen.getByRole('dialog', { name: 'Usage limit reached' })).toBeInTheDocument()
  })

  it('names the affected session in the dialog copy', () => {
    render(<UsageLimitToast />)
    emit()
    expect(screen.getByText('My Session')).toBeInTheDocument()
  })

  it('falls back to generic copy for an unknown session', () => {
    render(<UsageLimitToast />)
    emit({ sessionId: 'unknown' })
    expect(screen.getByText(/A session has hit its 5.hour usage limit\./)).toBeInTheDocument()
  })

  it('pre-fills the draft message with "continue"', () => {
    render(<UsageLimitToast />)
    emit()
    const input = screen.getByPlaceholderText('continue') as HTMLInputElement
    expect(input.value).toBe('continue')
  })

  it('labels the input with the computed send time (reset + delay)', () => {
    useSettingsStore.setState({ usageResetDelayMinutes: 5 })
    render(<UsageLimitToast />)
    emit()
    const clock = formatClockTime(expectedScheduledFor(5))
    expect(screen.getByText(new RegExp(`Send at ${clock.replace(/\s/g, '\\s')}`))).toBeInTheDocument()
  })

  it('pluralizes the delay hint', () => {
    useSettingsStore.setState({ usageResetDelayMinutes: 5 })
    render(<UsageLimitToast />)
    emit()
    expect(screen.getByText('Fires 5 minutes after the window resets.')).toBeInTheDocument()
  })

  it('uses the singular hint for a one-minute delay', () => {
    render(<UsageLimitToast />)
    emit()
    expect(screen.getByText('Fires 1 minute after the window resets.')).toBeInTheDocument()
  })

  it('disables the queue button when the draft is emptied', async () => {
    const user = userEvent.setup()
    render(<UsageLimitToast />)
    emit()
    await user.clear(screen.getByPlaceholderText('continue'))
    expect(screen.getByRole('button', { name: /Queue at/ })).toBeDisabled()
  })

  it('Dismiss closes the dialog without queueing anything', async () => {
    const user = userEvent.setup()
    render(<UsageLimitToast />)
    emit()
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(addQueuedMessageApi).not.toHaveBeenCalled()
  })

  it('queueing sends the trimmed draft to the scheduler and closes the dialog', async () => {
    const user = userEvent.setup()
    render(<UsageLimitToast />)
    emit()
    const input = screen.getByPlaceholderText('continue')
    await user.clear(input)
    await user.type(input, '  keep going  ')
    await user.click(screen.getByRole('button', { name: /Queue at/ }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(addQueuedMessageApi).toHaveBeenCalledTimes(1)
    const queued = addQueuedMessageApi.mock.calls[0][0] as QueuedMessage
    expect(queued.message).toBe('keep going')
    expect(queued.sessionId).toBe('s1')
    expect(queued.scheduledFor).toBe(expectedScheduledFor(1))
    expect(queued.reason).toBe('usage-reset')
  })

  it('queueing raises a success toast that names the session', async () => {
    const user = userEvent.setup()
    render(<UsageLimitToast />)
    emit()
    await user.click(screen.getByRole('button', { name: /Queue at/ }))
    await waitFor(() => {
      const toasts = useToastStore.getState().toasts
      expect(toasts.some((t) => t.type === 'success' && /My Session/.test(t.message))).toBe(true)
    })
  })

  it('auto-queue mode queues "continue" silently with an info toast and no dialog', async () => {
    useSettingsStore.setState({ autoQueueContinue: true })
    render(<UsageLimitToast />)
    emit()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(addQueuedMessageApi).toHaveBeenCalledTimes(1))
    const queued = addQueuedMessageApi.mock.calls[0][0] as QueuedMessage
    expect(queued.message).toBe('continue')
    const toasts = useToastStore.getState().toasts
    expect(toasts.some((t) => t.type === 'info' && /Auto.continue queued/.test(t.message))).toBe(true)
  })

  it('ignores events for sessions that already have a queued message', () => {
    useSchedulerStore.setState({
      queuedMessages: [
        {
          id: 'qm1',
          sessionId: 's1',
          message: 'continue',
          scheduledFor: Date.now() + 60_000,
          createdAt: 'now',
          reason: 'usage-reset',
        },
      ],
    })
    render(<UsageLimitToast />)
    emit()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('queues dialogs for multiple events and shows the next after dismissing', async () => {
    const user = userEvent.setup()
    useSessionStore.setState({
      sessions: [
        { id: 's1', name: 'First Session', branchName: 'a', worktreePath: '/a', projectId: 'p1', createdAt: 'now' },
        { id: 's2', name: 'Second Session', branchName: 'b', worktreePath: '/b', projectId: 'p1', createdAt: 'now' },
      ] as any,
    })
    render(<UsageLimitToast />)
    emit({ sessionId: 's1' })
    emit({ sessionId: 's2' })
    expect(screen.getByText('First Session')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.getByText('Second Session')).toBeInTheDocument()
  })

  it('warns when the session gains a queued message while the dialog is open', () => {
    render(<UsageLimitToast />)
    emit()
    expect(
      screen.queryByText(/already has a queued message/)
    ).not.toBeInTheDocument()
    act(() => {
      useSchedulerStore.setState({
        queuedMessages: [
          {
            id: 'qm1',
            sessionId: 's1',
            message: 'x',
            scheduledFor: Date.now() + 60_000,
            createdAt: 'now',
            reason: 'manual',
          },
        ],
      })
    })
    expect(screen.getByText(/already has a queued message/)).toBeInTheDocument()
  })
})
