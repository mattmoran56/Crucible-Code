import React, { useState } from 'react'
import { useSchedulerStore } from '../../stores/schedulerStore'
import { ScheduledSessionCard } from './ScheduledSessionCard'

interface Props {
  projectId: string
}

const ChevronIcon = ({ collapsed }: { collapsed: boolean }) => (
  <svg
    width="10"
    height="10"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={`text-text-muted transition-transform ${collapsed ? '' : 'rotate-90'}`}
  >
    <polyline points="9 18 15 12 9 6" />
  </svg>
)

/**
 * Collapsible panel of queued sessions for the active project. Renders
 * nothing when the project has none — keeps the sidebar uncluttered for
 * users who never schedule sessions.
 */
export function ScheduledSessionsPanel({ projectId }: Props) {
  const queuedSessions = useSchedulerStore((s) => s.queuedSessions)
  const cancelQueuedSession = useSchedulerStore((s) => s.cancelQueuedSession)
  const rescheduleQueuedSession = useSchedulerStore((s) => s.rescheduleQueuedSession)
  const fireQueuedSessionNow = useSchedulerStore((s) => s.fireQueuedSessionNow)

  const [collapsed, setCollapsed] = useState(false)

  const projectQueued = queuedSessions
    .filter((q) => q.projectId === projectId)
    .sort((a, b) => a.scheduledFor - b.scheduledFor)

  if (projectQueued.length === 0) return null

  return (
    <section className="flex-shrink-0 border-b border-border" style={{ maxHeight: 200 }}>
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center justify-between cursor-pointer select-none hover:bg-bg-tertiary"
        style={{ padding: '10px 12px' }}
      >
        <div className="flex items-center gap-1.5">
          <ChevronIcon collapsed={collapsed} />
          <h2 className="text-xs font-medium text-text-muted uppercase tracking-wide">
            Scheduled
          </h2>
          <span className="bg-accent text-bg text-[9px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
            {projectQueued.length}
          </span>
        </div>
      </button>
      {!collapsed && (
        <div className="overflow-y-auto" style={{ maxHeight: 160 }}>
          {projectQueued.map((session) => (
            <ScheduledSessionCard
              key={session.id}
              session={session}
              onFireNow={() => fireQueuedSessionNow(session.id)}
              onCancel={() => cancelQueuedSession(session.id)}
              onReschedule={(scheduledFor) => rescheduleQueuedSession(session.id, scheduledFor)}
            />
          ))}
        </div>
      )}
    </section>
  )
}
