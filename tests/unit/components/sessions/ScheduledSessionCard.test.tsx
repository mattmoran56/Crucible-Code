import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ScheduledSessionCard } from '../../../../src/renderer/components/sessions/ScheduledSessionCard'
import {
  formatClockTime,
  fromLocalDateTimeInputValue,
  toLocalDateTimeInputValue,
} from '../../../../src/renderer/lib/scheduleTime'
import type { QueuedSession } from '../../../../src/shared/types'

const TEN_MINUTES_OUT = Date.now() + 10 * 60_000

function makeSession(overrides: Partial<QueuedSession> = {}): QueuedSession {
  return {
    id: 'qs-1',
    projectId: 'p1',
    name: 'nightly-refactor',
    startupPrompt: 'Refactor the auth module',
    scheduledFor: TEN_MINUTES_OUT,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

function setup(overrides: Partial<QueuedSession> = {}) {
  const onFireNow = vi.fn()
  const onCancel = vi.fn()
  const onReschedule = vi.fn()
  const session = makeSession(overrides)
  render(
    <ScheduledSessionCard
      session={session}
      onFireNow={onFireNow}
      onCancel={onCancel}
      onReschedule={onReschedule}
    />
  )
  return { onFireNow, onCancel, onReschedule, session }
}

async function openMenu(user: ReturnType<typeof userEvent.setup>, name = 'nightly-refactor') {
  await user.click(screen.getByRole('button', { name: `Actions for ${name}` }))
}

describe('ScheduledSessionCard', () => {
  it('renders the session name', () => {
    setup()
    expect(screen.getByText('nightly-refactor')).toBeInTheDocument()
  })

  it('renders the relative time until launch', () => {
    setup()
    expect(screen.getByText('in 10m')).toBeInTheDocument()
  })

  it('renders the absolute clock time', () => {
    setup()
    const clock = formatClockTime(TEN_MINUTES_OUT)
    expect(screen.getByText(new RegExp(clock.replace(/\s/g, '\\s')))).toBeInTheDocument()
  })

  it('renders the startup prompt when present', () => {
    setup()
    expect(screen.getByText('Refactor the auth module')).toBeInTheDocument()
  })

  it('omits the startup prompt block when it is empty', () => {
    setup({ startupPrompt: '' })
    expect(screen.queryByText('Refactor the auth module')).not.toBeInTheDocument()
  })

  it('exposes an actions menu trigger labelled with the session name', () => {
    setup({ name: 'my-task' })
    expect(screen.getByRole('button', { name: 'Actions for my-task' })).toBeInTheDocument()
  })

  it('the actions menu lists Fire now, Reschedule and Cancel', async () => {
    const user = userEvent.setup()
    setup()
    await openMenu(user)
    expect(screen.getByRole('menuitem', { name: 'Fire now' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Reschedule…' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('Fire now invokes onFireNow', async () => {
    const user = userEvent.setup()
    const { onFireNow } = setup()
    await openMenu(user)
    await user.click(screen.getByRole('menuitem', { name: 'Fire now' }))
    expect(onFireNow).toHaveBeenCalledTimes(1)
  })

  it('Cancel invokes onCancel', async () => {
    const user = userEvent.setup()
    const { onCancel, onReschedule } = setup()
    await openMenu(user)
    await user.click(screen.getByRole('menuitem', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onReschedule).not.toHaveBeenCalled()
  })

  it('Reschedule opens a dialog titled "Reschedule session"', async () => {
    const user = userEvent.setup()
    setup()
    await openMenu(user)
    await user.click(screen.getByRole('menuitem', { name: 'Reschedule…' }))
    expect(screen.getByRole('dialog', { name: 'Reschedule session' })).toBeInTheDocument()
  })

  it('prefills the picker with the current scheduled time', async () => {
    const user = userEvent.setup()
    const { session } = setup()
    await openMenu(user)
    await user.click(screen.getByRole('menuitem', { name: 'Reschedule…' }))
    const input = screen.getByLabelText('Scheduled for') as HTMLInputElement
    expect(input.value).toBe(toLocalDateTimeInputValue(session.scheduledFor))
  })

  it('disables Save when the picker is cleared', async () => {
    const user = userEvent.setup()
    setup()
    await openMenu(user)
    await user.click(screen.getByRole('menuitem', { name: 'Reschedule…' }))
    fireEvent.change(screen.getByLabelText('Scheduled for'), { target: { value: '' } })
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('shows an error and disables Save for a time in the past', async () => {
    const user = userEvent.setup()
    setup()
    await openMenu(user)
    await user.click(screen.getByRole('menuitem', { name: 'Reschedule…' }))
    const past = toLocalDateTimeInputValue(Date.now() - 60 * 60_000)
    fireEvent.change(screen.getByLabelText('Scheduled for'), { target: { value: past } })
    expect(screen.getByText('Pick a time at least 30 seconds from now.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('saving a valid future time calls onReschedule with the epoch ms and closes the dialog', async () => {
    const user = userEvent.setup()
    const { onReschedule } = setup()
    await openMenu(user)
    await user.click(screen.getByRole('menuitem', { name: 'Reschedule…' }))
    const future = toLocalDateTimeInputValue(Date.now() + 2 * 60 * 60_000)
    fireEvent.change(screen.getByLabelText('Scheduled for'), { target: { value: future } })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onReschedule).toHaveBeenCalledWith(fromLocalDateTimeInputValue(future))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('the dialog Cancel button closes without rescheduling', async () => {
    const user = userEvent.setup()
    const { onReschedule } = setup()
    await openMenu(user)
    await user.click(screen.getByRole('menuitem', { name: 'Reschedule…' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onReschedule).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('relative label reads "now" when the launch time has arrived', () => {
    setup({ scheduledFor: Date.now() + 10_000 })
    expect(screen.getByText('now')).toBeInTheDocument()
  })

  it('relative label uses hours and minutes for longer waits', () => {
    setup({ scheduledFor: Date.now() + (2 * 60 + 5) * 60_000 })
    expect(screen.getByText('in 2h 5m')).toBeInTheDocument()
  })
})
