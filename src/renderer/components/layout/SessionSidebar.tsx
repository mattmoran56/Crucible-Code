import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import { useProjectStore } from '../../stores/projectStore'
import { usePRStore } from '../../stores/prStore'
import { useNotificationStore } from '../../stores/notificationStore'
import { useEditorStore } from '../../stores/editorStore'
import { editorContextIdFor } from '../editor/EditorWorkspace'
import { useSessionViewStore } from '../../stores/sessionViewStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTerminalStore } from '../../stores/terminalStore'
import { SessionCard } from '../sessions/SessionCard'
import { StaleSessionCard } from '../sessions/StaleSessionCard'
import { SessionSortMenu } from '../sessions/SessionSortMenu'
import { CreateSessionDialog } from '../sessions/CreateSessionDialog'
import { ImportWorktreeDialog } from '../sessions/ImportWorktreeDialog'
import { OpenBranchDialog } from '../sessions/OpenBranchDialog'
import { PRCard } from '../pullrequests/PRCard'
import { PRSortFilterMenu } from '../pullrequests/PRSortFilterMenu'
import { usePRViewStore, DEFAULT_PR_VIEW, isDefaultView, type PersonFilter } from '../../stores/prViewStore'
import { usePRListDisplayStore } from '../../stores/prListDisplayStore'
import { CodeBranchPicker } from './CodeBranchPicker'
import { DirtyCheckoutDialog } from './DirtyCheckoutDialog'
import { useToastStore } from '../../stores/toastStore'
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
  const { pullRequests, seenPRs, loading: prsLoading, loadPRs, loadSeenPRs, loadCurrentUser, markSeen, clear: clearPRs, currentUser } =
    usePRStore()
  const prViewByRepo = usePRViewStore((s) => s.byRepo)
  const resetPRView = usePRViewStore((s) => s.reset)
  const prListDisplayDefault = usePRListDisplayStore((s) => s.default)
  const prListDisplayByRepo = usePRListDisplayStore((s) => s.byRepo)
  const { clearContextStatuses, getContextStatus, registerSessions } = useNotificationStore()
  const [showCreate, setShowCreate] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showOpenBranch, setShowOpenBranch] = useState(false)
  const [prCollapsed, setPRCollapsed] = useState(false)
  const [staleCollapsed, setStaleCollapsed] = useState(true)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Listen for app-action create-session events from custom buttons
  useEffect(() => {
    const handler = () => setShowCreate(true)
    window.addEventListener('app:create-session', handler)
    return () => window.removeEventListener('app:create-session', handler)
  }, [])

  const activeProject = projects.find((p) => p.id === activeProjectId)

  // Measure the panels container directly (sections + handles) so panel sizing
  // is independent of the Code button's height or any other sibling. Use a
  // callback ref + state so the observer reattaches when SessionSidebar's
  // early-return path swaps in the real JSX after activeProject loads.
  const [panelsContainerEl, setPanelsContainerEl] = useState<HTMLDivElement | null>(null)
  const [panelsHeight, setPanelsHeight] = useState(0)

  useEffect(() => {
    if (!panelsContainerEl) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setPanelsHeight(entry.contentRect.height)
      }
    })
    observer.observe(panelsContainerEl)
    return () => observer.disconnect()
  }, [panelsContainerEl])

  const collapsedPanels = React.useMemo(
    () => [false, staleCollapsed, prCollapsed],
    [staleCollapsed, prCollapsed]
  )

  // Subtract two resize handles (3px each) so panel sizes sum to fill the
  // remaining space exactly.
  const panelSpace = Math.max(0, panelsHeight - 6)

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
    loadCurrentUser(activeProject.repoPath)

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
        session.worktreePath,
        'session'
      )
    }
    // Also register with the notification store for cross-project badge counts
    registerSessions(sessions)
  }, [sessions, registerSessions])

  // Register PRs as contexts so agent terminals opened in PR-only mode can route
  // their notifications back to the PR sidebar item that fired them.
  useEffect(() => {
    if (!activeProject) return
    for (const pr of pullRequests) {
      window.api.notification.registerSession(
        `__pr__:${pr.number}`,
        `PR #${pr.number} — ${pr.title}`,
        activeProject.id,
        activeProject.repoPath,
        'pr'
      )
    }
  }, [pullRequests, activeProject?.id, activeProject?.repoPath])

  const { editorMode, setEditorMode, currentBranch, loadBranch } = useEditorStore()

  const codeContextStatus = activeProjectId
    ? getContextStatus(editorContextIdFor(activeProjectId))
    : null
  const codeNeedsAttention = codeContextStatus === 'attention'

  // Load branch info for the Code nav item
  useEffect(() => {
    if (activeProject) {
      loadBranch(activeProject.repoPath)
    }
  }, [activeProject?.repoPath, loadBranch])

  const handleCodeClick = () => {
    setEditorMode(true)
    if (activeProjectId) {
      clearContextStatuses(editorContextIdFor(activeProjectId))
    }
  }

  // Branch-switch flow for the Code nav picker.
  const [pendingBranch, setPendingBranch] = useState<string | null>(null)
  const [checkoutBusy, setCheckoutBusy] = useState(false)

  const refreshOpenFiles = useCallback(async (repoPath: string) => {
    const { openFiles, handleExternalChange } = useEditorStore.getState()
    await Promise.all(
      openFiles.map((f) => handleExternalChange(f.path, repoPath))
    )
  }, [])

  const performCheckout = useCallback(async (
    repoPath: string,
    branch: string,
    mode: 'stash' | 'carry'
  ) => {
    const { addToast } = useToastStore.getState()
    setCheckoutBusy(true)
    try {
      const result = await window.api.git.checkout(repoPath, branch, mode)
      if (result.error) {
        addToast('error', result.error)
        return false
      }
      if (result.stashed) {
        addToast('info', `Stashed local changes before switching to ${branch}`)
      }
      if (result.detachedWorktree) {
        addToast('info', `Detached worktree at ${result.detachedWorktree} to free this branch`)
      }
      addToast('success', `Switched to ${branch}`)
      await loadBranch(repoPath)
      await refreshOpenFiles(repoPath)
      return true
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : String(err))
      return false
    } finally {
      setCheckoutBusy(false)
    }
  }, [loadBranch, refreshOpenFiles])

  const handleBranchSelect = useCallback(async (branch: string) => {
    if (!activeProject) return
    const repoPath = activeProject.repoPath
    try {
      const workingFiles = await window.api.git.workingFiles(repoPath)
      if (workingFiles.length > 0) {
        setPendingBranch(branch)
        return
      }
      await performCheckout(repoPath, branch, 'stash')
    } catch (err) {
      const { addToast } = useToastStore.getState()
      addToast('error', err instanceof Error ? err.message : String(err))
    }
  }, [activeProject, performCheckout])

  const handleDialogLeave = useCallback(async () => {
    if (!activeProject || !pendingBranch) return
    const ok = await performCheckout(activeProject.repoPath, pendingBranch, 'stash')
    if (ok) setPendingBranch(null)
  }, [activeProject, pendingBranch, performCheckout])

  const handleDialogCarry = useCallback(async () => {
    if (!activeProject || !pendingBranch) return
    const ok = await performCheckout(activeProject.repoPath, pendingBranch, 'carry')
    if (ok) setPendingBranch(null)
  }, [activeProject, pendingBranch, performCheckout])

  const { sortBy, groupBy, collapsedGroups, toggleGroupCollapsed } = useSessionViewStore()

  const sortedSessions = useMemo(() => {
    const sorted = [...sessions]
    switch (sortBy) {
      case 'created':
        sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        break
      case 'name':
        sorted.sort((a, b) => a.name.localeCompare(b.name))
        break
    }
    return sorted
  }, [sessions, sortBy])

  const groupedSessions = useMemo(() => {
    if (groupBy === 'none') return [{ label: null as string | null, sessions: sortedSessions }]

    const noPR: typeof sortedSessions = []
    const draft: typeof sortedSessions = []
    const open: typeof sortedSessions = []
    const merged: typeof sortedSessions = []

    for (const s of sortedSessions) {
      const pr = pullRequests.find((pr) => pr.headRefName === s.branchName)
      if (!pr) noPR.push(s)
      else if (pr.state === 'MERGED') merged.push(s)
      else if (pr.isDraft) draft.push(s)
      else open.push(s)
    }

    return [
      { label: 'No PR', sessions: noPR },
      { label: 'Draft PR', sessions: draft },
      { label: 'Open PR', sessions: open },
      { label: 'Merged PR', sessions: merged },
    ].filter((g) => g.sessions.length > 0)
  }, [sortedSessions, groupBy, pullRequests])

  const nonMergedPullRequests = useMemo(
    () => pullRequests.filter((pr) => pr.state !== 'MERGED'),
    [pullRequests]
  )

  const prRepoView = useMemo(
    () => (activeProject ? prViewByRepo[activeProject.repoPath] ?? DEFAULT_PR_VIEW : DEFAULT_PR_VIEW),
    [prViewByRepo, activeProject?.repoPath]
  )

  const openPullRequests = useMemo(() => {
    const matchPerson = (filter: PersonFilter, candidates: string[]): boolean => {
      if (filter.kind === 'anyone') return true
      if (filter.kind === 'me') return currentUser != null && candidates.includes(currentUser)
      return candidates.includes(filter.login)
    }

    const filtered = nonMergedPullRequests.filter((pr) => {
      if (pr.isDraft && !prRepoView.status.draft) return false
      if (!pr.isDraft && !prRepoView.status.ready) return false
      if (!prRepoView.ci[pr.ciStatus]) return false
      if (prRepoView.unseenOnly && seenPRs.includes(pr.number)) return false
      if (!matchPerson(prRepoView.assignee, pr.assignees)) return false
      if (!matchPerson(prRepoView.author, [pr.author])) return false
      if (!matchPerson(prRepoView.reviewer, pr.requestedReviewers)) return false
      return true
    })

    const sorted = [...filtered]
    switch (prRepoView.sortBy) {
      case 'number':
        sorted.sort((a, b) => b.number - a.number)
        break
      case 'updated':
        sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        break
      case 'created':
        sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        break
    }
    return sorted
  }, [nonMergedPullRequests, prRepoView, currentUser, seenPRs])

  // Find sessions with merged PRs
  const mergedSessions = useMemo(() => {
    return sessions.filter((s) => {
      const pr = pullRequests.find((pr) => pr.headRefName === s.branchName)
      return pr?.state === 'MERGED'
    })
  }, [sessions, pullRequests])

  // Manual cleanup — deletes all merged sessions immediately
  const cleanupMergedSessions = useCallback(async () => {
    if (!activeProject) return
    for (const session of mergedSessions) {
      await removeSession(activeProject.id, activeProject.repoPath, session.id)
    }
  }, [activeProject, mergedSessions, removeSession])

  // Close terminals only for a session (without deleting the session/worktree)
  const closeTerminalsForSession = useCallback(async (sessionId: string) => {
    await useTerminalStore.getState().killAllForSession(sessionId)
    await window.api.terminal.killSession(sessionId)
  }, [])

  // Auto-cleanup: track when merged sessions were first detected, apply action after delay
  const mergedCleanupAction = useSettingsStore((s) => s.mergedCleanupAction)
  const mergedCleanupDelay = useSettingsStore((s) => s.mergedCleanupDelay)
  const mergeDetectedAt = useRef<Record<string, number>>({})
  const cleanupTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Record first-seen timestamps for newly detected merged sessions
  useEffect(() => {
    const now = Date.now()
    for (const s of mergedSessions) {
      if (!mergeDetectedAt.current[s.id]) {
        mergeDetectedAt.current[s.id] = now
      }
    }
    // Remove entries for sessions no longer in the merged list
    const mergedIds = new Set(mergedSessions.map((s) => s.id))
    for (const id of Object.keys(mergeDetectedAt.current)) {
      if (!mergedIds.has(id)) delete mergeDetectedAt.current[id]
    }
  }, [mergedSessions])

  // Poll for sessions that have exceeded the delay
  useEffect(() => {
    if (mergedCleanupAction === 'nothing') {
      if (cleanupTimerRef.current) clearInterval(cleanupTimerRef.current)
      return
    }

    const check = async () => {
      if (!activeProject) return
      const now = Date.now()
      const delayMs = mergedCleanupDelay * 60_000

      for (const session of mergedSessions) {
        const detectedAt = mergeDetectedAt.current[session.id]
        if (!detectedAt || now - detectedAt < delayMs) continue

        if (mergedCleanupAction === 'deleteSession') {
          await removeSession(activeProject.id, activeProject.repoPath, session.id)
          delete mergeDetectedAt.current[session.id]
        } else if (mergedCleanupAction === 'closeTerminals') {
          await closeTerminalsForSession(session.id)
          delete mergeDetectedAt.current[session.id]
        }
      }
    }

    check()
    cleanupTimerRef.current = setInterval(check, 30_000) // check every 30s
    return () => {
      if (cleanupTimerRef.current) clearInterval(cleanupTimerRef.current)
    }
  }, [mergedCleanupAction, mergedCleanupDelay, mergedSessions, activeProject?.id])

  if (!activeProject) {
    return (
      <Sidebar>
        <div className="flex-1 flex items-center justify-center p-6">
          <p className="text-text-muted text-xs text-center">Add a project to get started</p>
        </div>
      </Sidebar>
    )
  }

  const newPRCount = nonMergedPullRequests.filter((pr) => !seenPRs.includes(pr.number)).length

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
    clearContextStatuses(`__pr__:${pr.number}`)
    await openPR(activeProject.repoPath, pr)
  }

  return (
    <Sidebar>
      {/* Code editor nav item — sibling of the panels container so its height
          doesn't have to be hard-coded into the resize math */}
      <div
        role="button"
        tabIndex={0}
        className={`flex-shrink-0 flex items-center gap-2 w-full text-left text-xs transition-colors border-b border-border cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-accent
          ${editorMode
            ? 'bg-accent/15 text-accent'
            : 'text-text-muted hover:text-text hover:bg-bg-tertiary'
          }`}
        style={{ padding: '10px 12px' }}
        onClick={handleCodeClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            handleCodeClick()
          }
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="16 18 22 12 16 6" />
          <polyline points="8 6 2 12 8 18" />
        </svg>
        <span className="font-medium">Code</span>
        {codeNeedsAttention && (
          <span
            aria-label="Agent waiting for attention"
            className="shrink-0 w-2 h-2 rounded-full bg-warning"
          />
        )}
        {currentBranch && activeProject && (
          <CodeBranchPicker
            repoPath={activeProject.repoPath}
            currentBranch={currentBranch}
            onSelect={handleBranchSelect}
          />
        )}
      </div>

      {activeProject && currentBranch && (
        <DirtyCheckoutDialog
          open={pendingBranch != null}
          fromBranch={currentBranch}
          targetBranch={pendingBranch ?? ''}
          busy={checkoutBusy}
          onCancel={() => setPendingBranch(null)}
          onLeave={handleDialogLeave}
          onCarry={handleDialogCarry}
        />
      )}

      <div ref={setPanelsContainerEl} className="flex flex-col flex-1 min-h-0">
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
            {groupedSessions.map((group) => {
              const isCollapsed = group.label ? collapsedGroups[group.label] : false
              return (
                <React.Fragment key={group.label ?? 'all'}>
                  {group.label && (
                    <button
                      onClick={() => toggleGroupCollapsed(group.label!)}
                      className="w-full flex items-center gap-1.5 px-2.5 py-1.5 mt-1 rounded hover:bg-bg-tertiary transition-colors cursor-pointer select-none"
                    >
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className={`text-text-muted transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
                      >
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                      <span className="text-[10px] text-text-muted uppercase tracking-wide font-semibold">
                        {group.label}
                      </span>
                      <span className="text-[10px] text-text-muted ml-auto tabular-nums">
                        {group.sessions.length}
                      </span>
                      {group.label === 'Merged PR' && (
                        <span
                          onClick={(e) => {
                            e.stopPropagation()
                            cleanupMergedSessions()
                          }}
                          className="text-[10px] text-danger hover:text-danger/80 ml-1.5 cursor-pointer"
                        >
                          Clean up
                        </span>
                      )}
                    </button>
                  )}
                  {!isCollapsed && group.sessions.map((session) => (
                    <SessionCard
                      key={session.id}
                      session={session}
                      isActive={!editorMode && session.id === activeSessionId}
                      isOpenedAsMain={session.id === openedAsMainBranch}
                      status={getContextStatus(session.id)}
                      pr={pullRequests.find((pr) => pr.headRefName === session.branchName)}
                      onClick={() => {
                        setEditorMode(false)
                        setActiveSession(session.id, activeProject.repoPath)
                        clearContextStatuses(session.id)
                      }}
                      onOpenAsMainBranch={() => openAsMainBranch(activeProject.repoPath, session.id)}
                      onMarkStale={() => markStale(activeProject.id, session.id)}
                      onDelete={() => removeSession(activeProject.id, activeProject.repoPath, session.id)}
                    />
                  ))}
                </React.Fragment>
              )
            })}
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
              <div className="flex items-center gap-1">
                <PRSortFilterMenu repoPath={activeProject.repoPath} />
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
              </div>
            }
          >
            {prsLoading && nonMergedPullRequests.length === 0 ? (
              <p className="text-text-muted text-xs text-center py-4">Loading...</p>
            ) : nonMergedPullRequests.length === 0 ? (
              <p className="text-text-muted text-xs text-center py-4">No open PRs</p>
            ) : openPullRequests.length === 0 ? (
              <div className="text-text-muted text-xs text-center py-4">
                <p>No PRs match filters</p>
                {!isDefaultView(prRepoView) && (
                  <button
                    onClick={() => resetPRView(activeProject.repoPath)}
                    className="text-accent hover:underline mt-1"
                  >
                    Reset filters
                  </button>
                )}
              </div>
            ) : (
              openPullRequests.map((pr) => (
                <PRCard
                  key={pr.number}
                  pr={pr}
                  isNew={!seenPRs.includes(pr.number)}
                  isActive={!editorMode && activePRNumber === pr.number}
                  needsAttention={getContextStatus(`__pr__:${pr.number}`) === 'attention'}
                  display={prListDisplayByRepo[activeProject.repoPath] ?? prListDisplayDefault}
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
