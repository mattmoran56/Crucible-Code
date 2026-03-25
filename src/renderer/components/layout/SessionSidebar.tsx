import React, { useEffect, useRef, useState } from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import { useProjectStore } from '../../stores/projectStore'
import { usePRStore } from '../../stores/prStore'
import { useNotificationStore } from '../../stores/notificationStore'
import { SessionCard } from '../sessions/SessionCard'
import { StaleSessionCard } from '../sessions/StaleSessionCard'
import { CreateSessionDialog } from '../sessions/CreateSessionDialog'
import { ImportWorktreeDialog } from '../sessions/ImportWorktreeDialog'
import { PRCard } from '../pullrequests/PRCard'
import { Sidebar, SidebarSection } from '../ui/Sidebar'
import { IconButton } from '../ui/IconButton'
import { DropdownMenu } from '../ui/DropdownMenu'
import { ResizeHandle } from '../ui/ResizeHandle'
import { useResizable } from '../../hooks/useResizable'

const PR_POLL_INTERVAL = 30_000

export function SessionSidebar() {
  const { projects, activeProjectId } = useProjectStore()
  const { sessions, staleSessions, activeSessionId, activePRNumber, openedAsMainBranch, loadSessions, setActiveSession, removeSession, markStale, openPR, openAsMainBranch, checkStaleness, reactivateSession } =
    useSessionStore()
  const { pullRequests, seenPRs, loading: prsLoading, loadPRs, loadSeenPRs, markSeen, clear: clearPRs } =
    usePRStore()
  const { pendingSessionIds, clearPending } = useNotificationStore()
  const [showCreate, setShowCreate] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [prCollapsed, setPRCollapsed] = useState(false)
  const [staleCollapsed, setStaleCollapsed] = useState(true)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const activeProject = projects.find((p) => p.id === activeProjectId)

  // Measure sidebar height for resize constraints
  const sidebarRef = useRef<HTMLDivElement>(null)
  const [sidebarHeight, setSidebarHeight] = useState(600)

  useEffect(() => {
    if (!sidebarRef.current) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setSidebarHeight(entry.contentRect.height)
      }
    })
    observer.observe(sidebarRef.current)
    return () => observer.disconnect()
  }, [])

  const sessionsPanel = useResizable({
    direction: 'vertical',
    initialSize: Math.round(sidebarHeight * 0.6),
    minSize: 80,
    maxSize: Math.round(sidebarHeight * 0.85),
  })

  // Load sessions then immediately check staleness (chained to avoid race condition)
  useEffect(() => {
    if (activeProjectId && activeProject) {
      loadSessions(activeProjectId).then(() => checkStaleness(activeProject.repoPath))
    }
  }, [activeProjectId])

  // Auto-expand stale sessions when there are some
  useEffect(() => {
    if (staleSessions.length > 0) {
      setStaleCollapsed(false)
    }
  }, [staleSessions.length])

  // Load and poll PRs + staleness
  useEffect(() => {
    if (!activeProject) {
      clearPRs()
      return
    }

    loadPRs(activeProject.repoPath)
    loadSeenPRs(activeProject.id)

    const startPolling = () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = setInterval(() => {
        loadPRs(activeProject.repoPath)
        checkStaleness(activeProject.repoPath)
      }, PR_POLL_INTERVAL)
    }
    startPolling()

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
    }
  }, [activeProject?.id])

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
      <Sidebar>
        <div className="flex-1 flex items-center justify-center p-6">
          <p className="text-text-muted text-xs text-center">Add a project to get started</p>
        </div>
      </Sidebar>
    )
  }

  const newPRCount = pullRequests.filter((pr) => !seenPRs.includes(pr.number)).length

  const handleRefreshPRs = () => {
    if (!activeProject) return
    loadPRs(activeProject.repoPath)
    // Reset polling so next tick is a full interval from now
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
    pollIntervalRef.current = setInterval(() => {
      loadPRs(activeProject.repoPath)
      checkStaleness(activeProject.repoPath)
    }, PR_POLL_INTERVAL)
  }

  const handlePRClick = async (pr: (typeof pullRequests)[0]) => {
    markSeen(activeProject.id, pr.number)
    await openPR(activeProject.repoPath, pr)
  }

  return (
    <Sidebar>
      <div ref={sidebarRef} className="flex flex-col flex-1 min-h-0">
        {/* Sessions section — height controlled by resize handle */}
        <div style={{ height: prCollapsed ? undefined : sessionsPanel.size, flexShrink: 0 }} className={prCollapsed ? 'flex-1 min-h-0' : 'min-h-0'}>
          <SidebarSection
            title="Sessions"
            action={
              <div className="flex items-center gap-1">
                <IconButton
                  label="New session"
                  onClick={() => setShowCreate(true)}
                  className="text-accent hover:text-accent-hover text-sm"
                >
                  +
                </IconButton>
                <DropdownMenu
                  items={[
                    { label: 'Import existing worktree', onClick: () => setShowImport(true) },
                  ]}
                >
                  <IconButton
                    label="Session options"
                    className="text-text-muted hover:text-text text-sm"
                  >
                    ⋮
                  </IconButton>
                </DropdownMenu>
              </div>
            }
          >
            {sessions.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                isActive={session.id === activeSessionId}
                isOpenedAsMain={session.id === openedAsMainBranch}
                hasPendingNotification={pendingSessionIds.has(session.id)}
                pr={pullRequests.find((pr) => pr.headRefName === session.branchName)}
                onClick={() => {
                  setActiveSession(session.id, activeProject.repoPath)
                  clearPending(session.id)
                }}
                onOpenAsMainBranch={() => openAsMainBranch(activeProject.repoPath, session.id)}
                onMarkStale={() => markStale(activeProject.id, session.id)}
                onDelete={() => removeSession(activeProject.id, activeProject.repoPath, session.id)}
              />
            ))}
            {sessions.length === 0 && (
              <p className="text-text-muted text-xs text-center py-4">No sessions yet</p>
            )}
          </SidebarSection>
        </div>

        {/* Resize handle between sections */}
        {!prCollapsed && (
          <ResizeHandle direction="vertical" onMouseDown={sessionsPanel.onMouseDown} />
        )}

        {/* Stale Sessions section — collapsible, fixed max-height */}
        <div className="flex-none" style={{ maxHeight: staleCollapsed ? undefined : 200, overflowY: staleCollapsed ? undefined : 'auto' }}>
          <SidebarSection
            title="Stale Sessions"
            collapsible
            collapsed={staleCollapsed}
            onToggle={() => setStaleCollapsed((c) => !c)}
          >
            {staleSessions.map((session) => (
              <StaleSessionCard
                key={session.id}
                session={session}
                isActive={session.id === activeSessionId}
                onClick={() => setActiveSession(session.id, activeProject.repoPath)}
                onReactivate={() => reactivateSession(activeProject.id, session.id)}
                onDelete={() => removeSession(activeProject.id, activeProject.repoPath, session.id)}
              />
            ))}
            {staleSessions.length === 0 && (
              <p className="text-text-muted text-xs text-center py-4">No stale sessions</p>
            )}
          </SidebarSection>
        </div>

        {/* Pull Requests section — fills remaining space */}
        <div className={prCollapsed ? '' : 'flex-1 min-h-0'}>
          <SidebarSection
            title="Pull Requests"
            collapsible
            collapsed={prCollapsed}
            onToggle={() => setPRCollapsed((c) => !c)}
            badge={newPRCount}
            action={
              <IconButton
                aria-label="Refresh pull requests"
                size="sm"
                onClick={handleRefreshPRs}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="23 4 23 10 17 10" />
                  <polyline points="1 20 1 14 7 14" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
              </IconButton>
            }
          >
            {prsLoading && pullRequests.length === 0 ? (
              <p className="text-text-muted text-xs text-center py-4">Loading...</p>
            ) : pullRequests.length === 0 ? (
              <p className="text-text-muted text-xs text-center py-4">No open PRs</p>
            ) : (
              pullRequests.map((pr) => (
                <PRCard
                  key={pr.number}
                  pr={pr}
                  isNew={!seenPRs.includes(pr.number)}
                  isActive={activePRNumber === pr.number}
                  onClick={() => handlePRClick(pr)}
                />
              ))
            )}
          </SidebarSection>
        </div>
      </div>

      <CreateSessionDialog
        open={showCreate}
        project={activeProject}
        onClose={() => setShowCreate(false)}
      />

      <ImportWorktreeDialog
        open={showImport}
        project={activeProject}
        onClose={() => setShowImport(false)}
      />
    </Sidebar>
  )
}
