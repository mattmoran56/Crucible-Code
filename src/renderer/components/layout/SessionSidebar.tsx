import React, { useEffect, useRef, useState } from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import { useProjectStore } from '../../stores/projectStore'
import { usePRStore } from '../../stores/prStore'
import { useNotificationStore } from '../../stores/notificationStore'
import { SessionCard } from '../sessions/SessionCard'
import { CreateSessionDialog } from '../sessions/CreateSessionDialog'
import { PRCard } from '../pullrequests/PRCard'
import { Sidebar, SidebarSection } from '../ui/Sidebar'
import { IconButton } from '../ui/IconButton'
import { ResizeHandle } from '../ui/ResizeHandle'
import { useResizable } from '../../hooks/useResizable'

const PR_POLL_INTERVAL = 30_000

export function SessionSidebar() {
  const { projects, activeProjectId } = useProjectStore()
  const { sessions, activeSessionId, activePRNumber, loadSessions, setActiveSession, removeSession, openPR } =
    useSessionStore()
  const { pullRequests, seenPRs, loading: prsLoading, loadPRs, loadSeenPRs, markSeen, clear: clearPRs } =
    usePRStore()
  const { pendingSessionIds, clearPending } = useNotificationStore()
  const [showCreate, setShowCreate] = useState(false)
  const [prCollapsed, setPRCollapsed] = useState(false)

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

  // Load sessions
  useEffect(() => {
    if (activeProjectId) {
      loadSessions(activeProjectId)
    }
  }, [activeProjectId, loadSessions])

  // Load and poll PRs
  useEffect(() => {
    if (!activeProject) {
      clearPRs()
      return
    }

    loadPRs(activeProject.repoPath)
    loadSeenPRs(activeProject.id)

    const interval = setInterval(() => {
      loadPRs(activeProject.repoPath)
    }, PR_POLL_INTERVAL)

    return () => clearInterval(interval)
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
                hasPendingNotification={pendingSessionIds.has(session.id)}
                pr={pullRequests.find((pr) => pr.headRefName === session.branchName)}
                onClick={() => {
                  setActiveSession(session.id)
                  clearPending(session.id)
                }}
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

        {/* Pull Requests section — fills remaining space */}
        <div className={prCollapsed ? '' : 'flex-1 min-h-0'}>
          <SidebarSection
            title="Pull Requests"
            collapsible
            collapsed={prCollapsed}
            onToggle={() => setPRCollapsed((c) => !c)}
            badge={newPRCount}
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
    </Sidebar>
  )
}
