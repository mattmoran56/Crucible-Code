import React, { useEffect, useState } from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import { useProjectStore } from '../../stores/projectStore'
import { SessionCard } from '../sessions/SessionCard'
import { CreateSessionDialog } from '../sessions/CreateSessionDialog'
import { Sidebar, SidebarSection } from '../ui/Sidebar'
import { IconButton } from '../ui/IconButton'

export function SessionSidebar() {
  const { projects, activeProjectId } = useProjectStore()
  const { sessions, activeSessionId, loadSessions, setActiveSession, removeSession } =
    useSessionStore()
  const [showCreate, setShowCreate] = useState(false)

  const activeProject = projects.find((p) => p.id === activeProjectId)

  useEffect(() => {
    if (activeProjectId) {
      loadSessions(activeProjectId)
    }
  }, [activeProjectId, loadSessions])

  if (!activeProject) {
    return (
      <Sidebar>
        <div className="flex-1 flex items-center justify-center p-6">
          <p className="text-text-muted text-xs text-center">Add a project to get started</p>
        </div>
      </Sidebar>
    )
  }

  return (
    <Sidebar>
      <SidebarSection
        title="Sessions"
        action={
          <IconButton
            label="New session"
            onClick={() => setShowCreate(true)}
            className="text-accent hover:text-accent-hover text-sm"
          >
            +
          </IconButton>
        }
      >
        {sessions.map((session) => (
          <SessionCard
            key={session.id}
            session={session}
            isActive={session.id === activeSessionId}
            onClick={() => setActiveSession(session.id)}
            onDelete={() => removeSession(activeProject.id, activeProject.repoPath, session.id)}
          />
        ))}
        {sessions.length === 0 && (
          <p className="text-text-muted text-xs text-center py-4">No sessions yet</p>
        )}
      </SidebarSection>

      <CreateSessionDialog
        open={showCreate}
        project={activeProject}
        onClose={() => setShowCreate(false)}
      />
    </Sidebar>
  )
}
