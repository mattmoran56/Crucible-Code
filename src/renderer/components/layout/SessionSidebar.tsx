import React, { useEffect, useState } from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import { useProjectStore } from '../../stores/projectStore'
import { useNotificationStore } from '../../stores/notificationStore'
import { SessionCard } from '../sessions/SessionCard'
import { CreateSessionDialog } from '../sessions/CreateSessionDialog'

export function SessionSidebar() {
  const { projects, activeProjectId } = useProjectStore()
  const { sessions, activeSessionId, loadSessions, setActiveSession } = useSessionStore()
  const { pendingSessionIds, clearPending } = useNotificationStore()
  const [showCreate, setShowCreate] = useState(false)

  const activeProject = projects.find((p) => p.id === activeProjectId)

  useEffect(() => {
    if (activeProjectId) {
      loadSessions(activeProjectId)
    }
  }, [activeProjectId, loadSessions])

  // Register all sessions with the main process for notification routing
  useEffect(() => {
    for (const session of sessions) {
      window.api.notification.registerSession(
        session.id,
        session.name,
        session.projectId,
        session.worktreePath
      )
    }
  }, [sessions])

  if (!activeProject) {
    return (
      <div className="w-56 bg-bg-secondary border-r border-border flex items-center justify-center p-6">
        <p className="text-text-muted text-xs text-center">
          Add a project to get started
        </p>
      </div>
    )
  }

  return (
    <div className="w-56 bg-bg-secondary border-r border-border flex flex-col">
      <div style={{ padding: '10px 12px' }} className="border-b border-border flex items-center justify-between">
        <span className="text-xs font-medium text-text-muted uppercase tracking-wide">
          Sessions
        </span>
        <button
          onClick={() => setShowCreate(true)}
          className="text-accent hover:text-accent-hover text-sm leading-none"
          title="New session"
        >
          +
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {sessions.map((session) => (
          <SessionCard
            key={session.id}
            session={session}
            isActive={session.id === activeSessionId}
            hasPendingNotification={pendingSessionIds.has(session.id)}
            onClick={() => {
              setActiveSession(session.id)
              clearPending(session.id)
            }}
          />
        ))}
        {sessions.length === 0 && (
          <p className="text-text-muted text-xs text-center py-4">
            No sessions yet
          </p>
        )}
      </div>

      {showCreate && (
        <CreateSessionDialog
          project={activeProject}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  )
}
