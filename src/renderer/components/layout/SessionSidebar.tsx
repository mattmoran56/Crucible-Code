import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import { useProjectStore } from '../../stores/projectStore'
import { usePRStore } from '../../stores/prStore'
import { usePRReviewStore } from '../../stores/prReviewStore'
import { useNotificationStore } from '../../stores/notificationStore'
import { useEditorStore } from '../../stores/editorStore'
import { editorContextIdFor } from '../editor/EditorWorkspace'
import { useSessionViewStore } from '../../stores/sessionViewStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTerminalStore } from '../../stores/terminalStore'
import { SessionCard } from '../sessions/SessionCard'
import { ScheduledSessionsPanel } from '../sessions/ScheduledSessionsPanel'
import { SessionSortMenu } from '../sessions/SessionSortMenu'
import { CreateSessionDialog } from '../sessions/CreateSessionDialog'
import { ImportWorktreeDialog } from '../sessions/ImportWorktreeDialog'
import { OpenBranchDialog } from '../sessions/OpenBranchDialog'
import { ClaudeWebSessionCardContainer } from '../sessions/ClaudeWebSessionCard'
import { useClaudeWebStore } from '../../stores/claudeWebStore'
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
  const { sessions, activeSessionId, activePRNumber, openedAsMainBranch, loadSessions, setActiveSession, removeSession, renameSession, setSessionCaptureLocalPr, openPR, openAsMainBranch, openBranch, reconcilePRWorktrees } =
    useSessionStore()
  const claudeWebSessions = useClaudeWebStore((s) => s.sessions)
  const claudeWebLoading = useClaudeWebStore((s) => s.loading)
  const loadClaudeWebSessions = useClaudeWebStore((s) => s.loadSessions)
  const clearClaudeWebSessions = useClaudeWebStore((s) => s.clear)
  const { pullRequests, localPRs, seenPRs, loading: prsLoading, loadPRs, loadLocalPRs, applyLocalPRUpdate, loadSeenPRs, loadCurrentUser, markSeen, clear: clearPRs, currentUser } =
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
  const [claudeWebCollapsed, setClaudeWebCollapsed] = useState(false)
  const [refreshingPRs, setRefreshingPRs] = useState(false)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Listen for app-action create-session events from custom buttons
  useEffect(() => {
    const handler = () => setShowCreate(true)
    window.addEventListener('app:create-session', handler)
    return () => window.removeEventListener('app:create-session', handler)
  }, [])

  // Cmd/Ctrl+N opens the New Session dialog when there's an active project.
  // Suppressed while the user is typing into an input/textarea or another
  // dialog already has focus, so it doesn't hijack normal text entry.
  // xterm renders a hidden .xterm-helper-textarea to capture keystrokes —
  // treat that as a terminal, not a real text input, so the shortcut works
  // when an agent terminal has focus.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return
      if (e.key.toLowerCase() !== 'n') return
      if (!activeProjectId) return
      const target = e.target as HTMLElement | null
      if (target) {
        const tag = target.tagName
        const isXtermInput = target.classList.contains('xterm-helper-textarea') || !!target.closest('.xterm')
        if (!isXtermInput) {
          if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
          if (target.isContentEditable) return
        }
        // Skip if focus is inside an open modal/dialog.
        if (target.closest('[role="dialog"]')) return
      }
      e.preventDefault()
      setShowCreate(true)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [activeProjectId])

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

  const claudeWebEnabled = !!activeProject?.claudeWebEnabled

  // Layout: 2 panels normally (Sessions ↔ PRs), 3 when Claude Web is enabled
  // (Sessions ↔ Claude Web ↔ PRs). The panels container is keyed on the toggle
  // to remount the resize hook with fresh refs when it flips.
  const collapsedPanels = React.useMemo(
    () =>
      claudeWebEnabled
        ? [false, claudeWebCollapsed, prCollapsed]
        : [false, prCollapsed],
    [claudeWebEnabled, claudeWebCollapsed, prCollapsed]
  )

  const minSizes = claudeWebEnabled ? [60, 60, 60] : [60, 60]
  const initialRatios = claudeWebEnabled ? [0.6, 0.2, 0.2] : [0.7, 0.3]
  const handleCount = claudeWebEnabled ? 2 : 1

  // Subtract resize handles (3px each) so panel sizes sum to fill the
  // remaining space exactly.
  const panelSpace = Math.max(0, panelsHeight - handleCount * 3)

  const { sizes, onHandleMouseDown } = useMultiPanelResize({
    containerSize: panelSpace,
    minSizes,
    initialRatios,
    collapsedPanels,
    collapsedSize: 37,
  })

  useEffect(() => {
    if (activeProjectId) {
      loadSessions(activeProjectId)
    }
  }, [activeProjectId])

  // Load and poll PRs
  useEffect(() => {
    if (!activeProject) {
      clearPRs()
      return
    }

    // loadPRs + reconcile: after each fetch, tear down any PR worktrees whose
    // PR is no longer open (merged, closed, or deleted upstream). The PR cache
    // includes merged PRs for the merged-tab UI, so we filter on state === 'OPEN'
    // before passing to reconcile.
    const refresh = async () => {
      await loadPRs(activeProject.repoPath)
      const openNumbers = usePRStore.getState()
        .pullRequests.filter((pr) => pr.state === 'OPEN')
        .map((pr) => pr.number)
      await reconcilePRWorktrees(activeProject.repoPath, openNumbers)
    }

    refresh()
    loadLocalPRs(activeProject.id)
    loadSeenPRs(activeProject.id)
    loadCurrentUser(activeProject.repoPath)

    const startPolling = () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = setInterval(() => {
        // Skip polling while the window is hidden/minimized — the GitHub API
        // hit + worktree reconcile + sidebar re-render adds up over hours of
        // background time.
        if (document.hidden) return
        refresh()
      }, PR_POLL_INTERVAL)
    }
    startPolling()

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
    }
  }, [activeProject?.id])

  // Live local-PR updates pushed from the main process (create / promote /
  // capture). Keeps the merged PR list fresh without polling gh.
  useEffect(() => {
    const unsub = window.api.localPr.onStateUpdate((projectId, list) => {
      applyLocalPRUpdate(projectId, list)
    })
    return () => { unsub() }
  }, [applyLocalPRUpdate])

  // Once a session's local PR is promoted to a real GitHub PR, drop the gh shim
  // for that session by clearing its persisted capture flag. Otherwise the
  // re-assert effect above (and app restart) would keep capturing `gh pr create`
  // into a fresh local PR even though the PR now lives on GitHub. The main
  // process already dropped the in-memory capture at promote time; this keeps it
  // dropped durably.
  useEffect(() => {
    for (const lpr of localPRs) {
      if (!lpr.sessionId || lpr.realPrNumber == null) continue
      const session = sessions.find((s) => s.id === lpr.sessionId)
      if (session?.captureLocalPr) {
        void setSessionCaptureLocalPr(session.projectId, session.id, false)
      }
    }
  }, [localPRs, sessions, setSessionCaptureLocalPr])

  // Claude Web sessions: load + poll on the same cadence when the project has
  // the feature enabled. Re-fires when currentUser arrives so the first list
  // isn't empty just because the GitHub login resolved after mount.
  useEffect(() => {
    if (!activeProject || !claudeWebEnabled) {
      clearClaudeWebSessions()
      return
    }
    const repoPath = activeProject.repoPath
    const prefix = activeProject.claudeWebBranchPrefix
    loadClaudeWebSessions(repoPath, prefix, currentUser)
    const interval = setInterval(() => {
      if (document.hidden) return
      loadClaudeWebSessions(repoPath, prefix, currentUser)
    }, PR_POLL_INTERVAL)
    return () => clearInterval(interval)
  }, [activeProject?.id, activeProject?.repoPath, activeProject?.claudeWebBranchPrefix, claudeWebEnabled, currentUser, loadClaudeWebSessions, clearClaudeWebSessions])

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
      // Re-assert local-PR capture intent so it applies to terminals spawned
      // after a restart (capture state lives in memory in the main process).
      window.api.localPr.setCapture(session.id, !!session.captureLocalPr)
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

  // Sessions whose branch matches the project's Claude Web prefix get
  // categorized under the Claude Web section instead of the regular Sessions
  // list. When the toggle is off, all sessions stay under Sessions.
  const normalizedClaudeWebPrefix = useMemo(() => {
    const raw = (activeProject?.claudeWebBranchPrefix ?? 'claude/').trim() || 'claude/'
    return raw.endsWith('/') ? raw : `${raw}/`
  }, [activeProject?.claudeWebBranchPrefix])

  const claudeWebActiveSessions = useMemo(() => {
    if (!claudeWebEnabled) return []
    return sessions.filter((s) => s.branchName.startsWith(normalizedClaudeWebPrefix))
  }, [claudeWebEnabled, sessions, normalizedClaudeWebPrefix])

  const regularSessions = useMemo(() => {
    if (!claudeWebEnabled) return sessions
    return sessions.filter((s) => !s.branchName.startsWith(normalizedClaudeWebPrefix))
  }, [claudeWebEnabled, sessions, normalizedClaudeWebPrefix])

  const sortedSessions = useMemo(() => {
    const sorted = [...regularSessions]
    switch (sortBy) {
      case 'created':
        sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        break
      case 'name':
        sorted.sort((a, b) => a.name.localeCompare(b.name))
        break
    }
    return sorted
  }, [regularSessions, sortBy])

  const sortedClaudeWebActiveSessions = useMemo(() => {
    return [...claudeWebActiveSessions].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
  }, [claudeWebActiveSessions])

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

  // Filter out Claude Web entries that are already opened locally or whose PR
  // is merged (those sessions are done — surfacing them would just clutter).
  const visibleClaudeWebSessions = useMemo(() => {
    if (!claudeWebEnabled) return []
    const activeBranchNames = new Set(sessions.map((s) => s.branchName))
    return claudeWebSessions.filter((c) => {
      if (activeBranchNames.has(c.branchName)) return false
      const pr = pullRequests.find((p) => p.headRefName === c.branchName)
      if (pr?.state === 'MERGED') return false
      return true
    })
  }, [claudeWebEnabled, claudeWebSessions, sessions, pullRequests])

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
      if (document.hidden) return
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
    setRefreshingPRs(true)
    // Refresh the list and — if a PR is currently open in the review panel —
    // also refetch its details so reviews/checks/comments aren't stale.
    const review = usePRReviewStore.getState()
    const openPR = review.prNumber
    const repoPath = activeProject.repoPath
    const refresh = async () => {
      await loadPRs(repoPath)
      const openNumbers = usePRStore.getState()
        .pullRequests.filter((pr) => pr.state === 'OPEN')
        .map((pr) => pr.number)
      await reconcilePRWorktrees(repoPath, openNumbers)
    }
    const tasks: Promise<unknown>[] = [refresh()]
    if (openPR != null) {
      tasks.push(review.loadPR(repoPath, openPR, activeProject.id, true))
    }
    Promise.allSettled(tasks).finally(() => setRefreshingPRs(false))
    // Reset polling so next tick is a full interval from now
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
    pollIntervalRef.current = setInterval(refresh, PR_POLL_INTERVAL)
  }

  const handlePRClick = async (pr: (typeof pullRequests)[0]) => {
    setEditorMode(false)
    if (pr.isLocal) {
      // Local PRs aren't on GitHub yet — there's no PR worktree to check out.
      // Jump to the producing session (matched by branch) so the user can keep
      // working or promote it. Full local-PR detail/promote view: Phase 2.
      const session = sessions.find((s) => s.branchName === pr.headRefName)
      if (session) setActiveSession(session.id)
      return
    }
    markSeen(activeProject.id, pr.number)
    clearContextStatuses(`__pr__:${pr.number}`)
    await openPR(activeProject.repoPath, pr)
  }

  const handleCreateLocalPR = async (session: (typeof sessions)[0]) => {
    await window.api.localPr.create({
      projectId: session.projectId,
      sessionId: session.id,
      worktreePath: session.worktreePath,
      branch: session.branchName,
      baseBranch: session.baseBranch,
    })
    // The main process pushes the new list via onStateUpdate; nothing else to do.
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

      <ScheduledSessionsPanel projectId={activeProject.id} />

      <div
        ref={setPanelsContainerEl}
        key={claudeWebEnabled ? 'panels-cw' : 'panels'}
        className="flex flex-col flex-1 min-h-0"
      >
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
                      onDelete={() => removeSession(activeProject.id, activeProject.repoPath, session.id)}
                      onRename={(newName) => renameSession(activeProject.id, activeProject.repoPath, session.id, newName)}
                      onCreateLocalPR={() => handleCreateLocalPR(session)}
                      onToggleCaptureLocalPr={() => setSessionCaptureLocalPr(activeProject.id, session.id, !session.captureLocalPr)}
                    />
                  ))}
                </React.Fragment>
              )
            })}
            {regularSessions.length === 0 && (
              <p className="text-text-muted text-xs text-center py-4">No sessions yet</p>
            )}
          </SidebarSection>
        </div>

        {claudeWebEnabled && (
          <>
            {/* Resize handle: Sessions ↔ Claude Web */}
            <ResizeHandle direction="vertical" onMouseDown={onHandleMouseDown(0)} />

            {/* Claude Web section */}
            <div style={{ height: sizes[1], flexShrink: 0 }} className="min-h-0 overflow-hidden">
              <SidebarSection
                title="Claude Web"
                collapsible
                collapsed={claudeWebCollapsed}
                onToggle={() => setClaudeWebCollapsed((c) => !c)}
                badge={visibleClaudeWebSessions.length + sortedClaudeWebActiveSessions.length}
                action={
                  <IconButton
                    label="Refresh Claude Web sessions"
                    size="sm"
                    loading={claudeWebLoading}
                    onClick={() => {
                      if (!activeProject) return
                      loadClaudeWebSessions(
                        activeProject.repoPath,
                        activeProject.claudeWebBranchPrefix,
                        currentUser
                      )
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="23 4 23 10 17 10" />
                      <polyline points="1 20 1 14 7 14" />
                      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                    </svg>
                  </IconButton>
                }
              >
                {sortedClaudeWebActiveSessions.map((session) => (
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
                    onDelete={() => removeSession(activeProject.id, activeProject.repoPath, session.id)}
                    onRename={(newName) => renameSession(activeProject.id, activeProject.repoPath, session.id, newName)}
                  />
                ))}
                {claudeWebLoading && visibleClaudeWebSessions.length === 0 && sortedClaudeWebActiveSessions.length === 0 ? (
                  <p className="text-text-muted text-xs text-center py-4">Loading...</p>
                ) : !currentUser && sortedClaudeWebActiveSessions.length === 0 ? (
                  <p className="text-text-muted text-xs text-center py-4">
                    Sign in with <code>gh</code> to discover your Claude web sessions
                  </p>
                ) : visibleClaudeWebSessions.length === 0 && sortedClaudeWebActiveSessions.length === 0 ? (
                  <p className="text-text-muted text-xs text-center py-4">No Claude web sessions</p>
                ) : (
                  visibleClaudeWebSessions.map((cw) => (
                    <ClaudeWebSessionCardContainer
                      key={cw.branchName}
                      session={cw}
                      pr={pullRequests.find((p) => p.headRefName === cw.branchName)}
                      onOpen={async () => {
                        const sessionName = cw.branchName.replace(/\//g, '-')
                        await openBranch(
                          activeProject.id,
                          activeProject.repoPath,
                          cw.branchName,
                          sessionName
                        )
                      }}
                    />
                  ))
                )}
              </SidebarSection>
            </div>
          </>
        )}

        {/* Resize handle: ↔ Pull Requests */}
        <ResizeHandle direction="vertical" onMouseDown={onHandleMouseDown(claudeWebEnabled ? 1 : 0)} />

        {/* Pull Requests section */}
        <div style={{ height: sizes[claudeWebEnabled ? 2 : 1], flexShrink: 0 }} className="min-h-0 overflow-hidden">
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
                  label="Refresh pull requests"
                  size="sm"
                  loading={refreshingPRs || prsLoading}
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
                  isNew={!pr.isLocal && !seenPRs.includes(pr.number)}
                  isActive={!editorMode && activePRNumber === pr.number}
                  needsAttention={getContextStatus(`__pr__:${pr.number}`) === 'attention'}
                  display={prListDisplayByRepo[activeProject.repoPath] ?? prListDisplayDefault}
                  onClick={() => handlePRClick(pr)}
                  onPromote={pr.isLocal && pr.localPrId ? () => window.api.localPr.promote(pr.localPrId!) : undefined}
                  onDiscard={pr.isLocal && pr.localPrId ? () => window.api.localPr.discard(pr.localPrId!) : undefined}
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
