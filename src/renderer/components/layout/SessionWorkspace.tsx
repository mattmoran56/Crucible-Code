import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { GitPanel } from '../git/GitPanel'
import { TerminalPanel } from '../terminal/TerminalPanel'
import { ReviewTerminalPanel } from '../terminal/ReviewTerminalPanel'
import { DynamicTerminalPanel } from '../terminal/DynamicTerminalPanel'
import { PRReviewPanel } from '../pullrequests/PRReviewPanel'
import { ResizeHandle } from '../ui'
import { useSessionStore } from '../../stores/sessionStore'
import { useProjectStore } from '../../stores/projectStore'
import { useTerminalStore } from '../../stores/terminalStore'
import { usePRStore } from '../../stores/prStore'
import { Button } from '../ui'
import { useGitStore } from '../../stores/gitStore'
import {
  useWorkspaceLayoutStore,
  isDynamicTab,
  type WorkspaceTab,
  type CoreTab,
} from '../../stores/workspaceLayoutStore'
import { ColumnPanel } from './WorkspaceColumn'

/** Tabs that require an active PR to be enabled */
const PR_REQUIRED_TABS: Set<WorkspaceTab> = new Set(['review'])

/* ── Main component ───────────────────────────────────── */

export function SessionWorkspace() {
  const { activeSessionId, activePRNumber, sessions, openedAsMainBranch, didStash, returnToWorktree } = useSessionStore()
  const { projects, activeProjectId } = useProjectStore()
  const activeProject = projects.find((p) => p.id === activeProjectId)
  const { columns, resetLayout, saveLayout, splitRight, addAvailableTab, removeAvailableTab, canSplit, addDynamicTab, removeDynamicTab } =
    useWorkspaceLayoutStore()
  const { killDynamicTerminalAll } = useTerminalStore()
  const workingFileCount = useGitStore((s) => s.workingFiles.length)

  const activeSession = sessions.find((s) => s.id === activeSessionId)
  const { pullRequests } = usePRStore()
  // Match session branch to a PR in the list
  const sessionPR = activeSession
    ? pullRequests.find((pr) => pr.headRefName === activeSession.branchName)
    : null
  // PR number: explicit activePRNumber takes priority, fall back to matched PR
  const effectivePRNumber = activePRNumber ?? sessionPR?.number ?? null
  const prOnlyMode = activePRNumber != null && activeSessionId == null

  // Track previous values to distinguish reset vs incremental change
  const prevSessionRef = useRef<string | null>(null)
  const prevPRRef = useRef<number | null>(null)
  const initializedRef = useRef(false)

  useEffect(() => {
    const prevContextId = prevSessionRef.current ?? (prevPRRef.current != null ? `pr-${prevPRRef.current}` : null)
    const sessionChanged = activeSessionId !== prevSessionRef.current

    // Save current layout before switching away
    if (prevContextId && (sessionChanged || !initializedRef.current)) {
      saveLayout(prevContextId)
    }

    if (!initializedRef.current || sessionChanged) {
      const contextId = activeSessionId ?? (activePRNumber != null ? `pr-${activePRNumber}` : undefined)
      if (prOnlyMode) {
        resetLayout(['pr', 'review'], 'pr', contextId)
      } else if (activeSessionId) {
        const sessionTabs: WorkspaceTab[] = sessionPR
          ? ['agent', 'git', 'pr', 'review']
          : ['agent', 'git', 'review']
        resetLayout(sessionTabs, 'agent', activeSessionId)
      } else {
        resetLayout([])
      }
      initializedRef.current = true
    }

    prevSessionRef.current = activeSessionId
    prevPRRef.current = effectivePRNumber
  }, [activeSessionId, effectivePRNumber, prOnlyMode])

  // Dynamically add/remove the PR tab when the session has a matching PR
  const prevSessionPRRef = useRef<number | null>(null)
  useEffect(() => {
    const prevPR = prevSessionPRRef.current
    const curPR = sessionPR?.number ?? null
    prevSessionPRRef.current = curPR

    // Only manage tab when in session mode (not PR-only mode)
    if (!activeSessionId || prOnlyMode) return

    if (curPR != null && prevPR == null) {
      addAvailableTab('pr')
    } else if (curPR == null && prevPR != null) {
      removeAvailableTab('pr')
    }
  }, [sessionPR?.number, activeSessionId, prOnlyMode])

  // Auto-save layout whenever columns change
  const currentContextId = activeSessionId ?? (activePRNumber != null ? `pr-${activePRNumber}` : null)
  useEffect(() => {
    if (currentContextId && columns.length > 0) {
      saveLayout(currentContextId)
    }
  }, [columns, currentContextId])

  // Column resize state
  const columnsRef = useRef<HTMLDivElement>(null)
  const resizeDrag = useRef<{
    leftId: string
    rightId: string
    startX: number
    leftStartWidth: number
    rightStartWidth: number
  } | null>(null)

  const onResizeStart = useCallback(
    (e: React.MouseEvent, leftId: string, rightId: string) => {
      e.preventDefault()
      const container = columnsRef.current
      if (!container) return
      const leftEl = container.querySelector(`[data-column-id="${leftId}"]`) as HTMLElement
      const rightEl = container.querySelector(`[data-column-id="${rightId}"]`) as HTMLElement
      if (!leftEl || !rightEl) return

      resizeDrag.current = {
        leftId,
        rightId,
        startX: e.clientX,
        leftStartWidth: leftEl.offsetWidth,
        rightStartWidth: rightEl.offsetWidth,
      }
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    },
    []
  )

  useEffect(() => {
    const { setColumnFlex } = useWorkspaceLayoutStore.getState()
    const onMouseMove = (e: MouseEvent) => {
      if (!resizeDrag.current) return
      const { leftId, rightId, startX, leftStartWidth, rightStartWidth } = resizeDrag.current
      const delta = e.clientX - startX
      const minWidth = 200
      const totalWidth = leftStartWidth + rightStartWidth

      let newLeft = leftStartWidth + delta
      let newRight = rightStartWidth - delta
      if (newLeft < minWidth) {
        newLeft = minWidth
        newRight = totalWidth - minWidth
      }
      if (newRight < minWidth) {
        newRight = minWidth
        newLeft = totalWidth - minWidth
      }

      setColumnFlex(leftId, newLeft)
      setColumnFlex(rightId, newRight)
    }

    const onMouseUp = () => {
      if (!resizeDrag.current) return
      resizeDrag.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  // Drag state for visual indicators
  const [dragOverInfo, setDragOverInfo] = useState<{
    columnId: string
    index: number
  } | null>(null)

  const splitEnabled = canSplit()

  // Handle adding a dynamic tab
  const handleAddDynamicTab = useCallback(
    (columnId: string, type: 'agent' | 'terminal') => {
      addDynamicTab(columnId, type)
    },
    [addDynamicTab]
  )

  // Handle closing a dynamic tab (kill terminal + remove from layout)
  const handleCloseDynamicTab = useCallback(
    (tab: WorkspaceTab) => {
      killDynamicTerminalAll(tab)
      removeDynamicTab(tab)
    },
    [killDynamicTerminalAll, removeDynamicTab]
  )

  // Stable portal target elements for core tabs — created once, never destroyed.
  const corePanelTargets = useRef<Record<CoreTab, HTMLDivElement> | null>(null)
  if (!corePanelTargets.current) {
    const allCoreTabs: CoreTab[] = ['agent', 'git', 'pr', 'review']
    corePanelTargets.current = {} as Record<CoreTab, HTMLDivElement>
    for (const tab of allCoreTabs) {
      const div = document.createElement('div')
      div.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;min-height:0'
      div.dataset.panelTarget = tab
      corePanelTargets.current[tab] = div
    }
  }

  // Dynamic portal targets — created/cleaned up as dynamic tabs appear/disappear
  const dynamicPanelTargets = useRef<Map<string, HTMLDivElement>>(new Map())

  // Compute all dynamic tabs currently in the layout
  const allDynamicTabs = useMemo(() => {
    const tabs = new Set<string>()
    for (const col of columns) {
      for (const tab of col.tabs) {
        if (isDynamicTab(tab)) tabs.add(tab)
      }
    }
    return tabs
  }, [columns])

  // Create/cleanup dynamic portal targets when dynamic tabs change
  useEffect(() => {
    const targets = dynamicPanelTargets.current

    // Create targets for new dynamic tabs
    for (const tab of allDynamicTabs) {
      if (!targets.has(tab)) {
        const div = document.createElement('div')
        div.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;min-height:0'
        div.dataset.panelTarget = tab
        targets.set(tab, div)
      }
    }

    // Remove targets for tabs no longer in layout
    for (const [tab, div] of targets) {
      if (!allDynamicTabs.has(tab)) {
        div.remove()
        targets.delete(tab)
      }
    }
  }, [allDynamicTabs])

  // Move portal targets into the correct column content areas on every layout change
  useEffect(() => {
    const coreTargets = corePanelTargets.current!
    const dynTargets = dynamicPanelTargets.current
    const container = columnsRef.current
    if (!container) return

    // Hide all core targets first
    for (const tab of Object.keys(coreTargets) as CoreTab[]) {
      coreTargets[tab].style.visibility = 'hidden'
      coreTargets[tab].style.pointerEvents = 'none'
      coreTargets[tab].style.zIndex = '0'
    }

    // Hide all dynamic targets
    for (const [, div] of dynTargets) {
      div.style.visibility = 'hidden'
      div.style.pointerEvents = 'none'
      div.style.zIndex = '0'
    }

    // Attach to correct columns and show active tabs
    for (const col of columns) {
      const contentEl = container.querySelector(
        `[data-column-id="${col.id}"] [data-column-content]`
      ) as HTMLElement
      if (!contentEl) continue

      for (const tab of col.tabs) {
        const target = isDynamicTab(tab) ? dynTargets.get(tab) : coreTargets[tab as CoreTab]
        if (!target) continue
        const isActive = tab === col.activeTab
        target.style.visibility = isActive ? 'visible' : 'hidden'
        target.style.pointerEvents = isActive ? 'auto' : 'none'
        target.style.zIndex = isActive ? '1' : '0'
        contentEl.appendChild(target)
      }
    }
  }, [columns])

  // Compute visibility for terminal panels
  const agentVisible = columns.some((c) => c.activeTab === 'agent')
  const reviewVisible = columns.some((c) => c.activeTab === 'review')

  const isPausedForMain = openedAsMainBranch != null && openedAsMainBranch === activeSessionId
  const pausedSession = isPausedForMain
    ? sessions.find((s) => s.id === openedAsMainBranch)
    : null

  // Never early-return when columns are present or when paused: the portals below
  // must stay mounted so the terminal (xterm) instance doesn't get detached from
  // the DOM. Detaching and re-appending xterm's element leaves its renderer in a
  // broken state, which manifested as a blank/white workspace after returning
  // from "Open as main branch".
  const showEmptyState = columns.length === 0 && !isPausedForMain

  return (
    <>
      <div
        className="flex-1 flex min-h-0 relative"
        ref={columnsRef}
        style={showEmptyState ? { display: 'none' } : undefined}
      >
        {columns.map((col, i) => (
          <React.Fragment key={col.id}>
            {i > 0 && (
              <ResizeHandle
                direction="horizontal"
                onMouseDown={(e) => onResizeStart(e, columns[i - 1].id, col.id)}
              />
            )}
            <ColumnPanel
              column={col}
              canClose={columns.length > 1}
              canSplit={splitEnabled}
              onSplit={splitRight}
              disabledTabs={effectivePRNumber == null ? PR_REQUIRED_TABS : undefined}
              disabledTooltip="Open a PR to use this tab"
              dragOverInfo={dragOverInfo}
              setDragOverInfo={setDragOverInfo}
              onAddDynamicTab={handleAddDynamicTab}
              onCloseDynamicTab={handleCloseDynamicTab}
              badge={workingFileCount > 0 ? { tab: 'git', count: workingFileCount } : undefined}
            />
          </React.Fragment>
        ))}
        {/* Paused overlay — covers the column tree while the session's branch is
            checked out in the main repo. Portals stay mounted underneath so the
            terminal isn't destroyed, and clicking "Return to worktree" just
            hides the overlay. */}
        {isPausedForMain && (
          <div className="absolute inset-0 flex items-center justify-center bg-bg z-10">
            <div className="flex flex-col items-center gap-4 text-center" style={{ maxWidth: 360 }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
                <circle cx="18" cy="18" r="3" />
                <circle cx="6" cy="6" r="3" />
                <path d="M13 6h3a2 2 0 0 1 2 2v7" />
                <line x1="6" y1="9" x2="6" y2="21" />
              </svg>
              <div>
                <h2 className="text-text text-sm font-medium mb-1">Session opened as main branch</h2>
                <p className="text-text-muted text-xs leading-relaxed">
                  <strong className="text-text">{pausedSession?.branchName}</strong> is checked out in the main repository. The worktree is paused.
                </p>
                {didStash && (
                  <p className="text-warning text-xs mt-2">
                    Uncommitted changes were stashed before switching.
                  </p>
                )}
              </div>
              <Button
                variant="primary"
                size="sm"
                onClick={() => activeProject && returnToWorktree(activeProject.repoPath)}
              >
                Return to worktree
              </Button>
            </div>
          </div>
        )}
      </div>
      {showEmptyState && (
        <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
          No session selected
        </div>
      )}
      {/* Core panel mounting — panels never unmount, just get portaled between columns */}
      {createPortal(<TerminalPanel mode="claude" visible={agentVisible && !isPausedForMain} />, corePanelTargets.current.agent)}
      {createPortal(<ReviewTerminalPanel visible={reviewVisible && !isPausedForMain} />, corePanelTargets.current.review)}
      {createPortal(<GitPanel />, corePanelTargets.current.git)}
      {createPortal(<PRReviewPanel />, corePanelTargets.current.pr)}
      {/* Dynamic panel mounting */}
      {[...allDynamicTabs].map((tab) => {
        const target = dynamicPanelTargets.current.get(tab)
        if (!target) return null
        const isVisible = columns.some((c) => c.activeTab === tab) && !isPausedForMain
        return createPortal(
          <DynamicTerminalPanel key={tab} tabId={tab as WorkspaceTab} visible={isVisible} />,
          target
        )
      })}
    </>
  )
}
