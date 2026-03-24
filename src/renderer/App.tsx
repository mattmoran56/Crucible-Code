import React, { useEffect } from 'react'
import { ProjectTabs } from './components/layout/ProjectTabs'
import { SessionSidebar } from './components/layout/SessionSidebar'
import { SessionWorkspace } from './components/layout/SessionWorkspace'
import { ResizeHandle } from './components/ui/ResizeHandle'
import { useProjectStore } from './stores/projectStore'
import { useSessionStore } from './stores/sessionStore'
import { useNotificationStore } from './stores/notificationStore'
import { useResizable } from './hooks/useResizable'
import { ToastContainer } from './components/ui/ToastContainer'

export default function App() {
  const { loadProjects, activeProjectId } = useProjectStore()
  const { activeSessionId } = useSessionStore()
  const { addPending, clearPending } = useNotificationStore()

  const sidebar = useResizable({ direction: 'horizontal', initialSize: 224, minSize: 140, maxSize: 400 })

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
      <ProjectTabs />

      <div className="flex-1 flex min-h-0">
        {/* Session sidebar — resizable width */}
        <div style={{ width: sidebar.size }} className="flex-shrink-0">
          <SessionSidebar />
        </div>
        <ResizeHandle direction="horizontal" onMouseDown={sidebar.onMouseDown} />

        {/* Session workspace: toolbar + content (agent or git view) */}
        <SessionWorkspace />
      </div>
      <ToastContainer />
    </div>
  )
}
