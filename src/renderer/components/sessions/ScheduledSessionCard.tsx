import React, { useEffect, useState } from 'react'
import type { QueuedSession } from '../../../shared/types'
import { IconButton } from '../ui/IconButton'
import { DropdownMenu } from '../ui/DropdownMenu'
import { Dialog } from '../ui/Dialog'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'
import {
  formatRelativeUntil,
  formatClockTime,
  toLocalDateTimeInputValue,
  fromLocalDateTimeInputValue,
} from '../../lib/scheduleTime'

interface Props {
  session: QueuedSession
  onFireNow: () => void
  onCancel: () => void
  onReschedule: (scheduledFor: number) => void
}

const EllipsisIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <circle cx="12" cy="5" r="2" />
    <circle cx="12" cy="12" r="2" />
    <circle cx="12" cy="19" r="2" />
  </svg>
)

const ClockIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
)

export function ScheduledSessionCard({ session, onFireNow, onCancel, onReschedule }: Props) {
  const [showReschedule, setShowReschedule] = useState(false)
  const [rescheduleValue, setRescheduleValue] = useState('')
  // Re-render every 30s so the relative time stays accurate without per-card timers fighting each other.
  const [, setNowTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setNowTick((n) => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])

  const relative = formatRelativeUntil(session.scheduledFor)
  const clock = formatClockTime(session.scheduledFor)

  const openReschedule = () => {
    setRescheduleValue(toLocalDateTimeInputValue(session.scheduledFor))
    setShowReschedule(true)
  }

  const submitReschedule = () => {
    const ms = fromLocalDateTimeInputValue(rescheduleValue)
    if (ms == null || ms < Date.now() + 30_000) return
    onReschedule(ms)
    setShowReschedule(false)
  }

  const newMs = fromLocalDateTimeInputValue(rescheduleValue)
  const newInPast = newMs != null && newMs < Date.now() + 30_000

  return (
    <>
      <div
        className="group w-full text-left text-xs relative text-text-muted hover:bg-bg-tertiary cursor-default"
        style={{ padding: '8px 12px' }}
      >
        <div className="flex items-center gap-2">
          <div className="font-medium text-text truncate flex-1 pr-5">{session.name}</div>
        </div>
        <div className="flex items-center gap-1 mt-1 text-text-muted text-[10px] pr-5">
          <ClockIcon />
          <span>{relative}</span>
          <span className="opacity-60">· {clock}</span>
        </div>
        {session.startupPrompt && (
          <div className="text-text-muted text-[10px] mt-1 truncate pr-5 italic opacity-80">
            {session.startupPrompt}
          </div>
        )}
        <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100">
          <DropdownMenu
            items={[
              { label: 'Fire now', onClick: onFireNow },
              { label: 'Reschedule…', onClick: openReschedule },
              { label: 'Cancel', variant: 'danger', onClick: onCancel },
            ]}
          >
            <IconButton label={`Actions for ${session.name}`} size="sm">
              <EllipsisIcon />
            </IconButton>
          </DropdownMenu>
        </div>
      </div>

      <Dialog open={showReschedule} onClose={() => setShowReschedule(false)} title="Reschedule session">
        <div className="flex flex-col gap-3">
          <Input
            label="Scheduled for"
            type="datetime-local"
            value={rescheduleValue}
            onChange={(e) => setRescheduleValue(e.target.value)}
            error={newInPast ? 'Pick a time at least 30 seconds from now.' : undefined}
          />
          <div className="flex gap-3 justify-end">
            <Button variant="ghost" size="sm" onClick={() => setShowReschedule(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" disabled={newMs == null || newInPast} onClick={submitReschedule}>
              Save
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  )
}
