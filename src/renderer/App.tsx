import React, { useEffect, useState } from 'react'
import { ProjectTabs } from './components/layout/ProjectTabs'
import { SessionSidebar } from './components/layout/SessionSidebar'
import { SessionWorkspace } from './components/layout/SessionWorkspace'
import { RightActivityBar } from './components/layout/RightActivityBar'
import { NotesPanel } from './components/notes/NotesPanel'
import { ResizeHandle, IconButton } from './components/ui'
import { useProjectStore } from './stores/projectStore'
import { useSessionStore } from './stores/sessionStore'
import { useNotificationStore } from './stores/notificationStore'
import { useResizable } from './hooks/useResizable'
import { ToastContainer } from './components/ui/ToastContainer'
import { SettingsPage } from './components/settings/SettingsPage'
import { useSettingsStore } from './stores/settingsStore'

export default function App() {
  const { loadProjects, activeProjectId } = useProjectStore()
  const { activeSessionId } = useSessionStore()
  const { addPending, clearPending } = useNotificationStore()
  const { isOpen: settingsOpen } = useSettingsStore()

  const sidebar = useResizable({ direction: 'horizontal', initialSize: 224, minSize: 140, maxSize: 400 })
  const rightPanel = useResizable({ direction: 'horizontal', initialSize: 300, minSize: 200, maxSize: 600, inverted: true })
  const [activeRightPanel, setActiveRightPanel] = useState<string | null>(null)

  const toggleRightPanel = (panel: string) =>
    setActiveRightPanel((prev) => (prev === panel ? null : panel))

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

  if (settingsOpen) {
    return (
      <div className="h-full flex flex-col">
        <SettingsPage />
        <ToastContainer />
      </div>
    )
  }

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

        {/* Right panel — shown when an activity bar icon is active */}
        {activeRightPanel && (
          <>
            <ResizeHandle direction="horizontal" onMouseDown={rightPanel.onMouseDown} />
            <div
              style={{ width: rightPanel.size }}
              className="flex-shrink-0 flex flex-col bg-bg-secondary"
            >
              <div
                className="flex items-center justify-between border-b border-border flex-shrink-0"
                style={{ padding: '10px 12px' }}
              >
                <span className="text-xs font-medium text-text-muted uppercase tracking-wide">
                  {activeRightPanel === 'notes' ? 'Notes' : activeRightPanel}
                </span>
                <IconButton label="Close panel" onClick={() => setActiveRightPanel(null)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </IconButton>
              </div>
              <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                {activeRightPanel === 'notes' && <NotesPanel />}
              </div>
            </div>
          </>
        )}

        {/* Right activity bar — always visible */}
        <RightActivityBar activePanel={activeRightPanel} onToggle={toggleRightPanel} />
      </div>
      <ToastContainer />
    </div>
  )
}
