import React, { useEffect } from 'react'
import { ProjectTabs } from './components/layout/ProjectTabs'
import { SessionSidebar } from './components/layout/SessionSidebar'
import { GitPanel } from './components/git/GitPanel'
import { TerminalPanel } from './components/terminal/TerminalPanel'
import { useProjectStore } from './stores/projectStore'
import { useSessionStore } from './stores/sessionStore'
import { useNotificationStore } from './stores/notificationStore'

export default function App() {
  const { loadProjects, activeProjectId } = useProjectStore()
  const { activeSessionId } = useSessionStore()
  const { addPending, clearPending } = useNotificationStore()

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  // Listen for hook-driven notification events from the main process
  useEffect(() => {
    const remove = window.api.notification.onHookEvent((sessionId: string) => {
      addPending(sessionId)
    })
    return remove
  }, [addPending])

  // Report active context to main process for suppression logic
  useEffect(() => {
    window.api.focus.setActiveContext(activeProjectId, activeSessionId)
  }, [activeProjectId, activeSessionId])

  // Auto-clear notification when user navigates to a session
  useEffect(() => {
    if (activeSessionId) {
      clearPending(activeSessionId)
    }
  }, [activeSessionId, clearPending])

  return (
    <div className="h-full flex flex-col">
      {/* Project tabs along the top */}
      <ProjectTabs />

      {/* Main content: sidebar + work area */}
      <div className="flex-1 flex min-h-0">
        {/* Session sidebar */}
        <SessionSidebar />

        {/* Work area: git panel (top) + terminal (bottom) */}
        <div className="flex-1 flex flex-col min-h-0">
          {/* Git panel — upper half */}
          <div className="flex-1 flex min-h-0 border-b border-border">
            <GitPanel />
          </div>

          {/* Terminal — lower half */}
          <div className="h-72 flex flex-col min-h-0">
            <TerminalPanel />
          </div>
        </div>
      </div>
    </div>
  )
}
