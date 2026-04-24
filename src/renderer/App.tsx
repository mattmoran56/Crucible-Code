import React, { useEffect, useState } from 'react'
import { ProjectTabs } from './components/layout/ProjectTabs'
import { SessionSidebar } from './components/layout/SessionSidebar'
import { SessionWorkspace } from './components/layout/SessionWorkspace'
import { EditorWorkspace } from './components/editor/EditorWorkspace'
import { useEditorStore } from './stores/editorStore'
import { RightActivityBar } from './components/layout/RightActivityBar'
import { NotesPanel } from './components/notes/NotesPanel'
import { UsagePanel } from './components/usage/UsagePanel'
import { PermissionsPanel } from './components/permissions/PermissionsPanel'
import { useUsageStore } from './stores/usageStore'
import { ResizeHandle, IconButton } from './components/ui'
import { useProjectStore } from './stores/projectStore'
import { useSessionStore } from './stores/sessionStore'
import { useNotificationStore } from './stores/notificationStore'
import { useTerminalStore } from './stores/terminalStore'
import { useResizable } from './hooks/useResizable'
import { ToastContainer } from './components/ui/ToastContainer'
import { SettingsPage } from './components/settings/SettingsPage'
import { useSettingsStore } from './stores/settingsStore'
import { LoadingScreen } from './components/LoadingScreen'
import { useButtonStore } from './stores/buttonStore'
import { useButtonShortcuts } from './hooks/useButtonShortcuts'

export default function App() {
  const { loadProjects, loadAccounts, projects } = useProjectStore()
  const { activeSessionId } = useSessionStore()
  const { editorMode } = useEditorStore()
  const { handleHookEvent, registerSessions } = useNotificationStore()
  const { isOpen: settingsOpen } = useSettingsStore()
  const { loadButtons, loadGroups } = useButtonStore()

  useButtonShortcuts()

  const sidebar = useResizable({ direction: 'horizontal', initialSize: 224, minSize: 140, maxSize: 400 })
  const rightPanel = useResizable({ direction: 'horizontal', initialSize: 300, minSize: 200, maxSize: 600, inverted: true })
  const [activeRightPanel, setActiveRightPanel] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [showLoader, setShowLoader] = useState(true)

  const toggleRightPanel = (panel: string) =>
    setActiveRightPanel((prev) => (prev === panel ? null : panel))

  // Listen for app-action panel toggle events from custom buttons
  useEffect(() => {
    const handler = (e: Event) => {
      const panel = (e as CustomEvent<{ panel: string }>).detail.panel
      toggleRightPanel(panel)
    }
    window.addEventListener('app:toggle-panel', handler)
    return () => window.removeEventListener('app:toggle-panel', handler)
  }, [])

  useEffect(() => {
    Promise.all([loadProjects(), loadAccounts(), loadButtons(), loadGroups()]).finally(() => {
      setLoading(false)
      // Unmount after fade-out transition (500ms)
      setTimeout(() => setShowLoader(false), 520)
    })
  }, [loadProjects, loadAccounts])

  // Register sessions from all projects with the notification store for cross-project badges
  // and recover any terminals that were running before a crash/restart
  useEffect(() => {
    if (projects.length === 0) return
    Promise.all(
      projects.map((p) => window.api.session.list(p.id))
    ).then((allSessionArrays) => {
      const allSessions = allSessionArrays.flat()
      registerSessions(allSessions)
      // Also register with main process for hook-based notification routing
      for (const s of allSessions) {
        window.api.notification.registerSession(s.id, s.name, s.projectId, s.worktreePath)
      }
      // Recover terminals from previous session (after crash/restart)
      useTerminalStore.getState().recoverTerminals(
        allSessions.map((s) => ({ id: s.id, name: s.name, worktreePath: s.worktreePath }))
      )
    })
  }, [projects, registerSessions])

  // Listen for hook-driven session status events from the main process
  useEffect(() => {
    const remove = window.api.notification.onSessionStatus((sessionId: string, hookType: string) => {
      handleHookEvent(sessionId, hookType as import('../../shared/types').HookType)
    })
    return remove
  }, [handleHookEvent])

  // Listen for usage updates pushed from the main process
  useEffect(() => {
    const remove = window.api.usage.onSessionUpdate((usage) => {
      useUsageStore.getState().updateSessionUsage(usage)
    })
    return remove
  }, [])

  // Auto-clear attention/completed when user navigates to a session (keep running visible)
  // Only fires on session switch — not reactively when hook events arrive
  useEffect(() => {
    if (activeSessionId) {
      const { sessionStatuses: statuses, clearStatus: clear } = useNotificationStore.getState()
      const status = statuses.get(activeSessionId)
      if (status === 'attention' || status === 'completed') {
        clear(activeSessionId)
      }
    }
  }, [activeSessionId])

  return (
    <div className="h-full flex flex-col">
      {showLoader && <LoadingScreen visible={!loading} />}
      {/* Settings overlay — main tree stays mounted but hidden */}
      {settingsOpen && <SettingsPage />}

      <div className={settingsOpen ? 'hidden' : 'contents'}>
        <ProjectTabs />

        <div className="flex-1 flex min-h-0">
          {/* Session sidebar — resizable width */}
          <div style={{ width: sidebar.size }} className="flex-shrink-0">
            <SessionSidebar />
          </div>
          <ResizeHandle direction="horizontal" onMouseDown={sidebar.onMouseDown} />

          {/* Main workspace: editor or session view */}
          {editorMode ? <EditorWorkspace /> : <SessionWorkspace />}

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
                    {activeRightPanel === 'notes' ? 'Notes' : activeRightPanel === 'usage' ? 'Usage' : activeRightPanel === 'permissions' ? 'Permissions' : activeRightPanel}
                  </span>
                  <IconButton label="Close panel" onClick={() => setActiveRightPanel(null)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </IconButton>
                </div>
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                  {activeRightPanel === 'notes' && <NotesPanel />}
                  {activeRightPanel === 'usage' && <UsagePanel />}
                  {activeRightPanel === 'permissions' && <PermissionsPanel />}
                </div>
              </div>
            </>
          )}

          {/* Right activity bar — always visible */}
          <RightActivityBar activePanel={activeRightPanel} onToggle={toggleRightPanel} />
        </div>
      </div>
      <ToastContainer />
    </div>
  )
}
