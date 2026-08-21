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
import { FoundryPanel } from './components/foundry/FoundryPanel'
import { OverseerPanel } from './components/overseer/OverseerPanel'
import { useUsageStore } from './stores/usageStore'
import { ResizeHandle, IconButton } from './components/ui'
import { useProjectStore } from './stores/projectStore'
import { useSessionStore } from './stores/sessionStore'
import { useNotificationStore } from './stores/notificationStore'
import { useTerminalStore } from './stores/terminalStore'
import { usePRStore } from './stores/prStore'
import { useWorkspaceLayoutStore, type WorkspaceTab } from './stores/workspaceLayoutStore'
import { useResizable } from './hooks/useResizable'
import { ToastContainer } from './components/ui/ToastContainer'
import { SettingsPage } from './components/settings/SettingsPage'
import { useSettingsStore } from './stores/settingsStore'
import { LoadingScreen } from './components/LoadingScreen'
import { useButtonStore } from './stores/buttonStore'
import { useButtonShortcuts } from './hooks/useButtonShortcuts'
import { useSettingsShortcut } from './hooks/useSettingsShortcut'
import { useReviewLoopStore } from './stores/reviewLoopStore'
import { useSchedulerBootstrap } from './hooks/useSchedulerBootstrap'
import { useNotionBootstrap } from './hooks/useNotionBootstrap'
import { useFoundryBootstrap } from './hooks/useFoundryBootstrap'
import { useOverseerStore } from './stores/overseerStore'
import { UsageLimitToast } from './components/usage/UsageLimitToast'

export default function App() {
  const { loadProjects, loadAccounts, projects } = useProjectStore()
  const { activeSessionId } = useSessionStore()
  const { editorMode } = useEditorStore()
  const { handleHookEvent, registerSessions, clearContextStatuses } = useNotificationStore()
  const { isOpen: settingsOpen } = useSettingsStore()
  const { loadButtons, loadGroups } = useButtonStore()
  const loadReviewLoopSettings = useReviewLoopStore((s) => s.loadSettings)
  const applyReviewLoopState = useReviewLoopStore((s) => s.applyState)

  useButtonShortcuts()
  useSettingsShortcut()
  useSchedulerBootstrap()
  useNotionBootstrap()
  useFoundryBootstrap()

  const sidebar = useResizable({ direction: 'horizontal', initialSize: 224, minSize: 140, maxSize: 400 })
  const rightPanel = useResizable({ direction: 'horizontal', initialSize: 300, minSize: 200, maxSize: 600, inverted: true })
  const [activeRightPanel, setActiveRightPanel] = useState<string | null>(null)
  const overseerUnread = useOverseerStore((s) => s.state.unread)
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
    Promise.all([
      loadProjects(),
      loadAccounts(),
      loadButtons(),
      loadGroups(),
      loadReviewLoopSettings(),
    ]).finally(() => {
      setLoading(false)
      // Unmount after fade-out transition (500ms)
      setTimeout(() => setShowLoader(false), 520)
    })
  }, [loadProjects, loadAccounts, loadButtons, loadGroups, loadReviewLoopSettings])

  // Stream review-loop progress events from the main process into the store.
  useEffect(() => {
    const remove = window.api.reviewLoop.onStateUpdate((state) => {
      applyReviewLoopState(state)
    })
    return remove
  }, [applyReviewLoopState])

  // Stream Overseer state (chat turns, heartbeat reports) from main. The panel
  // does not have to be open — a heartbeat that fires while it is closed still
  // lands in the thread and lights the activity-bar dot.
  useEffect(() => {
    void useOverseerStore.getState().load()
    return window.api.overseer.onStateUpdate((next) => {
      useOverseerStore.getState().applyState(next)
    })
  }, [])

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
        window.api.notification.registerSession(s.id, s.name, s.projectId, s.worktreePath, 'session')
      }
      // Recover terminals from previous session (after crash/restart)
      useTerminalStore.getState().recoverTerminals(
        allSessions.map((s) => ({ id: s.id, name: s.name, worktreePath: s.worktreePath }))
      )
    })
  }, [projects, registerSessions])

  // Listen for hook-driven status events from the main process. Each event is
  // attributed to a (contextId, tabId) pair — sessions, the Code editor, and PRs
  // are all "contexts".
  useEffect(() => {
    const remove = window.api.notification.onSessionStatus((contextId: string, tabId: string, hookType: string) => {
      handleHookEvent(contextId, tabId, hookType as import('../shared/types').HookType)
    })
    return remove
  }, [handleHookEvent])

  // OS notification clicks ask the renderer to focus the firing context + tab.
  useEffect(() => {
    const remove = window.api.notification.onFocusRequest(async (contextId: string, tabId: string) => {
      const { sessions, setActiveSession, openPR } = useSessionStore.getState()
      const { setEditorMode } = useEditorStore.getState()
      const { pullRequests } = usePRStore.getState()
      const { projects, setActiveProject, activeProjectId } = useProjectStore.getState()

      const focusTab = (cid: string) => {
        const { columns, setActiveTab } = useWorkspaceLayoutStore.getState()
        const tab = tabId as WorkspaceTab
        const col = columns.find((c) => c.tabs.includes(tab))
        if (col) setActiveTab(col.id, tab)
        clearContextStatuses(cid)
      }

      if (contextId.startsWith('code-editor:')) {
        const projectId = contextId.slice('code-editor:'.length)
        if (projects.some((p) => p.id === projectId)) setActiveProject(projectId)
        setEditorMode(true)
        setTimeout(() => focusTab(contextId), 0)
      } else if (contextId.startsWith('__pr__:')) {
        const prNumber = Number(contextId.slice('__pr__:'.length))
        const pr = pullRequests.find((p) => p.number === prNumber)
        const activeProject = projects.find((p) => p.id === activeProjectId)
        if (pr && activeProject) {
          setEditorMode(false)
          await openPR(activeProject.repoPath, pr)
          setTimeout(() => focusTab(contextId), 0)
        }
      } else {
        const session = sessions.find((s) => s.id === contextId)
        if (session) {
          const project = projects.find((p) => p.id === session.projectId)
          if (project) {
            setActiveProject(project.id)
            setEditorMode(false)
            setActiveSession(session.id, project.repoPath)
            setTimeout(() => focusTab(contextId), 0)
          }
        }
      }
    })
    return () => { remove() }
  }, [clearContextStatuses])

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
      const { getContextStatus, clearContextStatuses: clear } = useNotificationStore.getState()
      const status = getContextStatus(activeSessionId)
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

      <div style={{ display: settingsOpen ? 'none' : 'contents' }}>
        <ProjectTabs />

        <div className="flex-1 flex min-h-0">
          {/* Session sidebar — resizable width */}
          <div style={{ width: sidebar.size }} className="flex-shrink-0 h-full">
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
                    {activeRightPanel === 'notes' ? 'Notes' : activeRightPanel === 'usage' ? 'Usage' : activeRightPanel === 'permissions' ? 'Permissions' : activeRightPanel === 'foundry' ? 'Foundry' : activeRightPanel === 'overseer' ? 'Overseer' : activeRightPanel}
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
                  {activeRightPanel === 'foundry' && <FoundryPanel />}
                  {activeRightPanel === 'overseer' && <OverseerPanel />}
                </div>
              </div>
            </>
          )}

          {/* Right activity bar — always visible */}
          <RightActivityBar
            activePanel={activeRightPanel}
            onToggle={toggleRightPanel}
            overseerUnread={overseerUnread}
          />
        </div>
      </div>
      <UsageLimitToast />
      <ToastContainer />
    </div>
  )
}
