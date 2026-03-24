import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { GitPanel } from '../git/GitPanel'
import { TerminalPanel } from '../terminal/TerminalPanel'
import { ReviewTerminalPanel } from '../terminal/ReviewTerminalPanel'
import { PRReviewPanel } from '../pullrequests/PRReviewPanel'
import { IconButton, Tooltip, ResizeHandle } from '../ui'
import { useSessionStore } from '../../stores/sessionStore'
import { usePRStore } from '../../stores/prStore'
import {
  useWorkspaceLayoutStore,
  type WorkspaceColumn,
  type WorkspaceTab,
} from '../../stores/workspaceLayoutStore'

/* ── Icons ────────────────────────────────────────────── */

const TerminalIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" y1="19" x2="20" y2="19" />
  </svg>
)

const GitIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="18" cy="18" r="3" />
    <circle cx="6" cy="6" r="3" />
    <path d="M13 6h3a2 2 0 0 1 2 2v7" />
    <line x1="6" y1="9" x2="6" y2="21" />
  </svg>
)

const PRIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="18" cy="18" r="3" />
    <circle cx="6" cy="6" r="3" />
    <path d="M13 6h3a2 2 0 0 1 2 2v7" />
    <path d="M6 9v12" />
    <path d="M18 15v-4a2 2 0 0 0-2-2h-3" />
  </svg>
)

const SplitIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="18" rx="1" />
    <rect x="14" y="3" width="7" height="18" rx="1" />
  </svg>
)

const CloseIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)

const ReviewIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
)

const TAB_ICONS: Record<WorkspaceTab, React.ReactNode> = {
  agent: <TerminalIcon />,
  git: <GitIcon />,
  pr: <PRIcon />,
  review: <ReviewIcon />,
}

const TAB_LABELS: Record<WorkspaceTab, string> = {
  agent: 'Agent',
  git: 'Worktree',
  pr: 'PR',
  review: 'Review',
}

/** Tabs that require an active PR to be enabled */
const PR_REQUIRED_TABS: Set<WorkspaceTab> = new Set(['review'])

/* ── Drag & Drop types ────────────────────────────────── */

interface DragData {
  tab: WorkspaceTab
  sourceColumnId: string
}

const DRAG_MIME = 'application/x-workspace-tab'

/* ── Main component ───────────────────────────────────── */

export function SessionWorkspace() {
  const { activeSessionId, activePRNumber, sessions } = useSessionStore()
  const { columns, resetLayout, saveLayout, splitRight, addAvailableTab, removeAvailableTab, setActiveTab, canSplit } =
    useWorkspaceLayoutStore()

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
        resetLayout(['agent', 'git', 'review'], 'agent', activeSessionId)
      } else {
        resetLayout([])
      }
      initializedRef.current = true
    }

    prevSessionRef.current = activeSessionId
    prevPRRef.current = effectivePRNumber
  }, [activeSessionId, effectivePRNumber, prOnlyMode])

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

  // Stable portal target elements — created once, never destroyed.
  // Panels are portaled into these, then we move the targets between column content areas.
  const panelTargets = useRef<Record<WorkspaceTab, HTMLDivElement> | null>(null)
  if (!panelTargets.current) {
    const allTabs: WorkspaceTab[] = ['agent', 'git', 'pr', 'review']
    panelTargets.current = {} as Record<WorkspaceTab, HTMLDivElement>
    for (const tab of allTabs) {
      const div = document.createElement('div')
      div.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;min-height:0'
      div.dataset.panelTarget = tab
      panelTargets.current[tab] = div
    }
  }

  // Move portal targets into the correct column content areas on every layout change
  useEffect(() => {
    const targets = panelTargets.current!
    const container = columnsRef.current
    if (!container) return

    // Hide all targets first
    for (const tab of Object.keys(targets) as WorkspaceTab[]) {
      targets[tab].style.visibility = 'hidden'
      targets[tab].style.pointerEvents = 'none'
      targets[tab].style.zIndex = '0'
    }

    // Attach to correct columns and show active tabs
    for (const col of columns) {
      const contentEl = container.querySelector(
        `[data-column-id="${col.id}"] [data-column-content]`
      ) as HTMLElement
      if (!contentEl) continue

      for (const tab of col.tabs) {
        const target = targets[tab]
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

  if (columns.length === 0) {
    return <div className="flex-1 flex items-center justify-center text-text-muted text-sm">No session selected</div>
  }

  return (
    <>
      <div className="flex-1 flex min-h-0" ref={columnsRef}>
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
              effectivePRNumber={effectivePRNumber}
              dragOverInfo={dragOverInfo}
              setDragOverInfo={setDragOverInfo}
            />
          </React.Fragment>
        ))}
      </div>
      {/* Global panel mounting — panels never unmount, just get portaled between columns */}
      {createPortal(<TerminalPanel mode="claude" visible={agentVisible} />, panelTargets.current.agent)}
      {createPortal(<ReviewTerminalPanel visible={reviewVisible} />, panelTargets.current.review)}
      {createPortal(<GitPanel />, panelTargets.current.git)}
      {createPortal(<PRReviewPanel />, panelTargets.current.pr)}
    </>
  )
}

/* ── Column Panel ─────────────────────────────────────── */

function ColumnPanel({
  column,
  canClose,
  canSplit,
  onSplit,
  effectivePRNumber,
  dragOverInfo,
  setDragOverInfo,
}: {
  column: WorkspaceColumn
  canClose: boolean
  canSplit: boolean
  onSplit: () => void
  effectivePRNumber: number | null
  dragOverInfo: { columnId: string; index: number } | null
  setDragOverInfo: (info: { columnId: string; index: number } | null) => void
}) {
  const { setActiveTab, closeColumn, moveTab, reorderTab } = useWorkspaceLayoutStore()
  const tabBarRef = useRef<HTMLDivElement>(null)

  /* ── Drag handlers for the column's tab bar ── */

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_MIME)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'

      // Determine drop index from cursor position
      const tabBar = tabBarRef.current
      if (!tabBar) return
      const tabEls = tabBar.querySelectorAll<HTMLElement>('[data-tab]')
      let dropIndex = column.tabs.length
      for (let i = 0; i < tabEls.length; i++) {
        const rect = tabEls[i].getBoundingClientRect()
        if (e.clientX < rect.left + rect.width / 2) {
          dropIndex = i
          break
        }
      }
      setDragOverInfo({ columnId: column.id, index: dropIndex })
    },
    [column.id, column.tabs.length, setDragOverInfo]
  )

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      // Only clear if leaving the tab bar entirely
      const tabBar = tabBarRef.current
      if (tabBar && !tabBar.contains(e.relatedTarget as Node)) {
        setDragOverInfo(null)
      }
    },
    [setDragOverInfo]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragOverInfo(null)
      const raw = e.dataTransfer.getData(DRAG_MIME)
      if (!raw) return
      const data: DragData = JSON.parse(raw)

      if (data.sourceColumnId === column.id) {
        // Reorder within column
        const fromIndex = column.tabs.indexOf(data.tab)
        const tabBar = tabBarRef.current
        if (!tabBar) return
        const tabEls = tabBar.querySelectorAll<HTMLElement>('[data-tab]')
        let toIndex = column.tabs.length - 1
        for (let i = 0; i < tabEls.length; i++) {
          const rect = tabEls[i].getBoundingClientRect()
          if (e.clientX < rect.left + rect.width / 2) {
            toIndex = i
            break
          }
        }
        if (fromIndex !== toIndex) {
          reorderTab(column.id, fromIndex, toIndex)
        }
      } else {
        // Move between columns
        const tabBar = tabBarRef.current
        let targetIndex = column.tabs.length
        if (tabBar) {
          const tabEls = tabBar.querySelectorAll<HTMLElement>('[data-tab]')
          for (let i = 0; i < tabEls.length; i++) {
            const rect = tabEls[i].getBoundingClientRect()
            if (e.clientX < rect.left + rect.width / 2) {
              targetIndex = i
              break
            }
          }
        }
        moveTab(data.tab, data.sourceColumnId, column.id, targetIndex)
      }
    },
    [column.id, column.tabs, moveTab, reorderTab, setDragOverInfo]
  )

  const isDragOver = dragOverInfo?.columnId === column.id

  return (
    <div
      className="flex flex-col min-h-0 min-w-0"
      style={{ flex: column.flex }}
      data-column-id={column.id}
    >
      {/* Tab bar */}
      <div
        ref={tabBarRef}
        className={`flex items-center bg-bg-tertiary border-b border-border ${
          isDragOver ? 'ring-1 ring-inset ring-accent/40' : ''
        }`}
        style={{ padding: '0 4px' }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="flex items-center flex-1 min-w-0">
          {column.tabs.map((tab, i) => (
            <React.Fragment key={tab}>
              {/* Drop indicator line */}
              {isDragOver && dragOverInfo?.index === i && (
                <div className="w-[2px] h-5 bg-accent rounded-full flex-shrink-0" />
              )}
              <DraggableTab
                tab={tab}
                active={tab === column.activeTab}
                disabled={PR_REQUIRED_TABS.has(tab) && effectivePRNumber == null}
                disabledTooltip="Open a PR to use this tab"
                columnId={column.id}
                onClick={() => setActiveTab(column.id, tab)}
              />
            </React.Fragment>
          ))}
          {/* Trailing drop indicator */}
          {isDragOver && dragOverInfo?.index === column.tabs.length && (
            <div className="w-[2px] h-5 bg-accent rounded-full flex-shrink-0" />
          )}
        </div>
        <div className="flex items-center flex-shrink-0 gap-0.5" style={{ marginLeft: '4px' }}>
          <IconButton label="Split editor" size="sm" onClick={onSplit} disabled={!canSplit}>
            <SplitIcon />
          </IconButton>
          {canClose && (
            <IconButton label="Close split" size="sm" onClick={() => closeColumn(column.id)}>
              <CloseIcon />
            </IconButton>
          )}
        </div>
      </div>

      {/* Content — portal targets get moved here by SessionWorkspace */}
      <div className="flex-1 flex flex-col min-h-0 relative" data-column-content />
    </div>
  )
}

/* ── Draggable Tab ────────────────────────────────────── */

function DraggableTab({
  tab,
  active,
  disabled,
  disabledTooltip,
  columnId,
  onClick,
}: {
  tab: WorkspaceTab
  active: boolean
  disabled?: boolean
  disabledTooltip?: string
  columnId: string
  onClick: () => void
}) {
  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      if (disabled) {
        e.preventDefault()
        return
      }
      const data: DragData = { tab, sourceColumnId: columnId }
      e.dataTransfer.setData(DRAG_MIME, JSON.stringify(data))
      e.dataTransfer.effectAllowed = 'move'
    },
    [tab, columnId, disabled]
  )

  const button = (
    <button
      data-tab={tab}
      draggable={!disabled}
      onDragStart={handleDragStart}
      onClick={disabled ? undefined : onClick}
      role="tab"
      aria-selected={active}
      aria-disabled={disabled}
      className={`flex items-center gap-1.5 text-xs transition-colors relative
        focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset
        ${disabled
          ? 'text-text-muted/40 cursor-not-allowed'
          : active
            ? 'text-text cursor-grab active:cursor-grabbing'
            : 'text-text-muted hover:text-text cursor-grab active:cursor-grabbing'
        }`}
      style={{ padding: '8px 10px' }}
    >
      {TAB_ICONS[tab]}
      {TAB_LABELS[tab]}
      {active && !disabled && <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent" />}
    </button>
  )

  if (disabled && disabledTooltip) {
    return <Tooltip content={disabledTooltip} side="bottom">{button}</Tooltip>
  }

  return button
}

