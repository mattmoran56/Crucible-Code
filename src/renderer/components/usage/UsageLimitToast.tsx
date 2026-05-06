import React, { useEffect, useState } from 'react'
import { useSettingsStore } from '../../stores/settingsStore'
import { useSchedulerStore } from '../../stores/schedulerStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useToastStore } from '../../stores/toastStore'
import { Dialog } from '../ui/Dialog'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'
import { formatClockTime } from '../../lib/scheduleTime'
import type { UsageLimitEvent, QueuedMessage } from '../../../shared/types'

interface PendingEvent extends UsageLimitEvent {
  uid: string
}

const DEFAULT_MESSAGE = 'continue'

/**
 * Listens for `usage:limit-reached` events from the main process.
 * - If the user has opted into auto-queue, immediately enqueues a 'continue'
 *   message at (resetsAt + delayMinutes) and shows a status toast.
 * - Otherwise, opens an interactive confirmation dialog where the user can
 *   tweak the message text or dismiss.
 *
 * Mount once at the top of the component tree.
 */
export function UsageLimitToast() {
  const autoQueueContinue = useSettingsStore((s) => s.autoQueueContinue)
  const usageResetDelayMinutes = useSettingsStore((s) => s.usageResetDelayMinutes)
  const addQueuedMessage = useSchedulerStore((s) => s.addQueuedMessage)
  const queuedMessages = useSchedulerStore((s) => s.queuedMessages)

  const [pending, setPending] = useState<PendingEvent[]>([])
  const [draft, setDraft] = useState(DEFAULT_MESSAGE)

  useEffect(() => {
    const unsubscribe = window.api.usage.onLimitReached((event) => {
      const sessions = useSessionStore.getState().sessions
      const session = sessions.find((s) => s.id === event.sessionId)
      // Skip: limit reached for a session that already has a queued message
      // (avoids stacking dialogs after main-process-broadcast races).
      const alreadyQueued = useSchedulerStore
        .getState()
        .queuedMessages.some((m) => m.sessionId === event.sessionId)
      if (alreadyQueued) return

      const scheduledFor = event.resetsAt * 1000 + usageResetDelayMinutes * 60_000

      if (autoQueueContinue) {
        const item: QueuedMessage = {
          id: crypto.randomUUID(),
          sessionId: event.sessionId,
          message: DEFAULT_MESSAGE,
          scheduledFor,
          createdAt: new Date().toISOString(),
          reason: 'usage-reset',
        }
        addQueuedMessage(item)
        useToastStore.getState().addToast(
          'info',
          `Auto‑continue queued for ${formatClockTime(scheduledFor)}${session ? ` (${session.name})` : ''}`
        )
        return
      }

      setPending((p) => [...p, { ...event, uid: crypto.randomUUID() }])
    })
    return () => { unsubscribe() }
  }, [autoQueueContinue, usageResetDelayMinutes, addQueuedMessage])

  // When the dialog opens for a new event, reset the draft to default. We
  // intentionally don't memoize — the user opening, editing, then dismissing
  // shouldn't carry that draft over to the next event.
  const current = pending[0] ?? null
  useEffect(() => {
    if (current) setDraft(DEFAULT_MESSAGE)
  }, [current?.uid])

  if (!current) return null

  const session = useSessionStore.getState().sessions.find((s) => s.id === current.sessionId)
  const scheduledFor = current.resetsAt * 1000 + usageResetDelayMinutes * 60_000
  const alreadyQueuedNow = queuedMessages.some((m) => m.sessionId === current.sessionId)

  const handleQueue = async () => {
    const trimmed = draft.trim()
    if (!trimmed) return
    const item: QueuedMessage = {
      id: crypto.randomUUID(),
      sessionId: current.sessionId,
      message: trimmed,
      scheduledFor,
      createdAt: new Date().toISOString(),
      reason: 'usage-reset',
    }
    await addQueuedMessage(item)
    useToastStore.getState().addToast(
      'success',
      `Queued '${trimmed}' for ${formatClockTime(scheduledFor)}${session ? ` (${session.name})` : ''}`
    )
    setPending((p) => p.slice(1))
  }

  const handleDismiss = () => {
    setPending((p) => p.slice(1))
  }

  return (
    <Dialog open={true} onClose={handleDismiss} title="Usage limit reached">
      <div className="flex flex-col gap-3">
        <p className="text-xs text-text-muted">
          {session ? <><strong className="text-text">{session.name}</strong> has hit its 5‑hour usage limit.</> : 'A session has hit its 5‑hour usage limit.'}
          {' '}Queue a follow‑up prompt to fire automatically once the window resets.
        </p>
        <Input
          label={`Send at ${formatClockTime(scheduledFor)}`}
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          placeholder="continue"
          hint={`Fires ${usageResetDelayMinutes} minute${usageResetDelayMinutes === 1 ? '' : 's'} after the window resets.`}
        />
        {alreadyQueuedNow && (
          <p className="text-[11px] text-warning">
            This session already has a queued message — submitting will replace it.
          </p>
        )}
        <div className="flex gap-3 justify-end">
          <Button variant="ghost" size="sm" onClick={handleDismiss}>
            Dismiss
          </Button>
          <Button variant="primary" size="sm" onClick={handleQueue} disabled={!draft.trim()}>
            Queue at {formatClockTime(scheduledFor)}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
