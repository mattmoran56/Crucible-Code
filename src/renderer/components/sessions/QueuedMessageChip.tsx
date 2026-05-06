import React, { useEffect, useState } from 'react'
import { useSchedulerStore } from '../../stores/schedulerStore'
import { useSessionStore } from '../../stores/sessionStore'
import { formatClockTime, formatRelativeUntil } from '../../lib/scheduleTime'

const ClockIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
)

const CloseIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)

/**
 * Floating chip rendered above the agent terminal of the active session
 * when a queued message is pending. Shows the absolute time + relative
 * countdown, and a × to cancel.
 */
export function QueuedMessageChip() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const queuedMessages = useSchedulerStore((s) => s.queuedMessages)
  const cancelQueuedMessage = useSchedulerStore((s) => s.cancelQueuedMessage)

  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])

  if (!activeSessionId) return null
  const queued = queuedMessages.find((m) => m.sessionId === activeSessionId)
  if (!queued) return null

  return (
    <div
      className="absolute top-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 text-[11px] text-text bg-bg-tertiary border border-border rounded-full shadow-sm"
      style={{ padding: '4px 10px' }}
      role="status"
    >
      <ClockIcon />
      <span>
        Queued <span className="font-mono">{queued.message}</span> for {formatClockTime(queued.scheduledFor)}
        <span className="text-text-muted"> · {formatRelativeUntil(queued.scheduledFor)}</span>
      </span>
      <button
        type="button"
        onClick={() => cancelQueuedMessage(queued.id)}
        aria-label="Cancel queued message"
        className="text-text-muted hover:text-danger ml-1"
      >
        <CloseIcon />
      </button>
    </div>
  )
}
