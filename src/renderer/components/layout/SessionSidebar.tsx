import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import { useProjectStore } from '../../stores/projectStore'
import { usePRStore } from '../../stores/prStore'
import { useNotificationStore } from '../../stores/notificationStore'
import { useEditorStore } from '../../stores/editorStore'
import { useSessionViewStore } from '../../stores/sessionViewStore'
import { SessionCard } from '../sessions/SessionCard'
import { StaleSessionCard } from '../sessions/StaleSessionCard'
import { SessionSortMenu } from '../sessions/SessionSortMenu'
import { CreateSessionDialog } from '../sessions/CreateSessionDialog'
import { ImportWorktreeDialog } from '../sessions/ImportWorktreeDialog'
import { OpenBranchDialog } from '../sessions/OpenBranchDialog'
import { PRCard } from '../pullrequests/PRCard'
import { Sidebar, SidebarSection } from '../ui/Sidebar'
import { IconButton } from '../ui/IconButton'
import { DropdownMenu } from '../ui/DropdownMenu'
import { ResizeHandle } from '../ui/ResizeHandle'
import { useMultiPanelResize } from '../../hooks/useMultiPanelResize'

const PR_POLL_INTERVAL = 30_000

export function SessionSidebar() {
  const { projects, activeProjectId } = useProjectStore()
  const { sessions, staleSessions, activeSessionId, activePRNumber, openedAsMainBranch, loadSessions, setActiveSession, removeSession, markStale, openPR, openAsMainBranch, checkStaleness, reactivateSession } =
    useSessionStore()
  const { pullRequests, seenPRs, loading: prsLoading, loadPRs, loadSeenPRs, markSeen, clear: clearPRs } =
    usePRStore()
  const { sessionStatuses, clearStatus, registerSessions } = useNotificationStore()
  const [showCreate, setShowCreate] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showOpenBranch, setShowOpenBranch] = useState(false)
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

  const collapsedPanels = React.useMemo(
    () => [false, staleCollapsed, prCollapsed],
    [staleCollapsed, prCollapsed]
  )

  // Subtract Code button (~37px) and two resize handles (3px each) from available space
  const panelSpace = Math.max(0, sidebarHeight - 37 - 6)

  const { sizes, onHandleMouseDown } = useMultiPanelResize({
    containerSize: panelSpace,
    minSizes: [60, 60, 60],
    initialRatios: [0.5, 0.25, 0.25],
    collapsedPanels,
    collapsedSize: 37,
  })

  // Load sessions then immediately check staleness (chained to avoid race condition)
  useEffect(() => {
    let cancelled = false
    if (activeProjectId && activeProject) {
      loadSessions(activeProjectId).then(() => {
        if (!cancelled) checkStaleness(activeProject.repoPath)
      })
    }
    return () => { cancelled = true }
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
    // Also register with the notification store for cross-project badge counts
    registerSessions(sessions)
  }, [sessions, registerSessions])

  const { editorMode, setEditorMode, currentBranch, loadBranch } = useEditorStore()

  // Load branch info for the Code nav item
  useEffect(() => {
    if (activeProject) {
      loadBranch(activeProject.repoPath)
    }
  }, [activeProject?.repoPath, loadBranch])

  const handleCodeClick = () => {
    setEditorMode(true)
  }

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
    setEditorMode(false)
    markSeen(activeProject.id, pr.number)
    await openPR(activeProject.repoPath, pr)
  }

  const { sortBy, groupBy } = useSessionViewStore()

  const sortedSessions = useMemo(() => {
    const sorted = [...sessions]
    switch (sortBy) {
      case 'created':
        sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        break
      case 'lastActive':
        sorted.sort((a, b) => {
          const aTime = a.lastActiveAt ? new Date(a.lastActiveAt).getTime() : new Date(a.createdAt).getTime()
          const bTime = b.lastActiveAt ? new Date(b.lastActiveAt).getTime() : new Date(b.createdAt).getTime()
          return bTime - aTime
        })
        break
      case 'name':
        sorted.sort((a, b) => a.name.localeCompare(b.name))
        break
    }
    return sorted
  }, [sessions, sortBy])

  const groupedSessions = useMemo(() => {
    if (groupBy === 'none') return [{ label: null as string | null, sessions: sortedSessions }]

    const active: typeof sortedSessions = []
    const draft: typeof sortedSessions = []
    const noPR: typeof sortedSessions = []

    for (const s of sortedSessions) {
      const pr = pullRequests.find((pr) => pr.headRefName === s.branchName)
      if (!pr) noPR.push(s)
      else if (pr.isDraft) draft.push(s)
      else active.push(s)
    }

    return [
      { label: 'Active PR', sessions: active },
      { label: 'Draft PR', sessions: draft },
      { label: 'No PR', sessions: noPR },
    ].filter((g) => g.sessions.length > 0)
  }, [sortedSessions, groupBy, pullRequests])

  return (
    <Sidebar>
      <div ref={sidebarRef} className="flex flex-col flex-1 min-h-0">
        {/* Code editor nav item */}
        <button
          className={`flex items-center gap-2 w-full text-left text-xs transition-colors border-b border-border
            ${editorMode
              ? 'bg-accent/15 text-accent'
              : 'text-text-muted hover:text-text hover:bg-bg-tertiary'
            }`}
          style={{ padding: '10px 12px' }}
          onClick={handleCodeClick}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
          <span className="font-medium">Code</span>
          {currentBranch && (
            <span className="ml-auto text-text-muted text-[10px] truncate" style={{ maxWidth: 80 }}>
              {currentBranch}
            </span>
          )}
        </button>

        {/* Sessions section */}
        <div style={{ height: sizes[0], flexShrink: 0 }} className="min-h-0 overflow-hidden">
          <SidebarSection
            title="Sessions"
            action={
              <div className="flex items-center gap-1">
                <SessionSortMenu />
                <IconButton
                  label="New session"
                  onClick={() => setShowCreate(true)}
                  className="text-accent hover:text-accent-hover text-sm"
                >
                  +
                </IconButton>
                <DropdownMenu
                  items={[
                    { label: 'Open existing branch', onClick: () => setShowOpenBranch(true) },
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
            {groupedSessions.map((group) => (
              <React.Fragment key={group.label ?? 'all'}>
                {group.label && (
                  <div className="text-[10px] text-text-muted uppercase tracking-wide font-medium px-1 pt-2 pb-1">
                    {group.label}
                  </div>
                )}
                {group.sessions.map((session) => (
                  <SessionCard
                    key={session.id}
                    session={session}
                    isActive={!editorMode && session.id === activeSessionId}
                    isOpenedAsMain={session.id === openedAsMainBranch}
                    status={sessionStatuses.get(session.id) ?? null}
                    pr={pullRequests.find((pr) => pr.headRefName === session.branchName)}
                    onClick={() => {
                      setEditorMode(false)
                      setActiveSession(session.id, activeProject.repoPath)
                      clearStatus(session.id)
                    }}
                    onOpenAsMainBranch={() => openAsMainBranch(activeProject.repoPath, session.id)}
                    onMarkStale={() => markStale(activeProject.id, session.id)}
                    onDelete={() => removeSession(activeProject.id, activeProject.repoPath, session.id)}
                  />
                ))}
              </React.Fragment>
            ))}
            {sessions.length === 0 && (
              <p className="text-text-muted text-xs text-center py-4">No sessions yet</p>
            )}
          </SidebarSection>
        </div>

        {/* Resize handle: Sessions ↔ Stale Sessions */}
        <ResizeHandle direction="vertical" onMouseDown={onHandleMouseDown(0)} />

        {/* Stale Sessions section */}
        <div style={{ height: sizes[1], flexShrink: 0 }} className="min-h-0 overflow-hidden">
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
                isActive={!editorMode && session.id === activeSessionId}
                onClick={() => { setEditorMode(false); setActiveSession(session.id, activeProject.repoPath) }}
                onReactivate={() => reactivateSession(activeProject.id, session.id)}
                onDelete={() => removeSession(activeProject.id, activeProject.repoPath, session.id)}
              />
            ))}
            {staleSessions.length === 0 && (
              <p className="text-text-muted text-xs text-center py-4">No stale sessions</p>
            )}
          </SidebarSection>
        </div>

        {/* Resize handle: Stale Sessions ↔ Pull Requests */}
        <ResizeHandle direction="vertical" onMouseDown={onHandleMouseDown(1)} />

        {/* Pull Requests section */}
        <div style={{ height: sizes[2], flexShrink: 0 }} className="min-h-0 overflow-hidden">
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
                  isActive={!editorMode && activePRNumber === pr.number}
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

      <OpenBranchDialog
        open={showOpenBranch}
        project={activeProject}
        onClose={() => setShowOpenBranch(false)}
      />

      <ImportWorktreeDialog
        open={showImport}
        project={activeProject}
        onClose={() => setShowImport(false)}
      />
    </Sidebar>
  )
}
