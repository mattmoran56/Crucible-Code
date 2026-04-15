import React, { useCallback, useEffect, useRef, useState } from 'react'
import { IconButton, Tooltip, ResizeHandle } from '../ui'
import { CustomButtonBar } from '../buttons/CustomButtonBar'
import { useGitStore } from '../../stores/gitStore'
import {
  useWorkspaceLayoutStore,
  isDynamicTab,
  getTabBaseType,
  getTabLabel,
  type WorkspaceColumn as WorkspaceColumnType,
  type WorkspaceTab,
} from '../../stores/workspaceLayoutStore'

/* ── Icons ────────────────────────────────────────────── */

export const TerminalIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" y1="19" x2="20" y2="19" />
  </svg>
)

export const GitIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="18" cy="18" r="3" />
    <circle cx="6" cy="6" r="3" />
    <path d="M13 6h3a2 2 0 0 1 2 2v7" />
    <line x1="6" y1="9" x2="6" y2="21" />
  </svg>
)

export const PRIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="18" cy="18" r="3" />
    <circle cx="6" cy="6" r="3" />
    <path d="M13 6h3a2 2 0 0 1 2 2v7" />
    <path d="M6 9v12" />
    <path d="M18 15v-4a2 2 0 0 0-2-2h-3" />
  </svg>
)

export const SplitIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="18" rx="1" />
    <rect x="14" y="3" width="7" height="18" rx="1" />
  </svg>
)

export const CloseIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)

export const ReviewIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
)

export const PlusIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
)

export const ShellIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <polyline points="7 15 10 12 7 9" />
    <line x1="13" y1="15" x2="17" y2="15" />
  </svg>
)

export const CodeIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="16 18 22 12 16 6" />
    <polyline points="8 6 2 12 8 18" />
  </svg>
)

/** Get the icon for a tab */
export function getTabIcon(tab: WorkspaceTab): React.ReactNode {
  if (tab === 'agent') return <TerminalIcon />
  if (tab === 'git') return <GitIcon />
  if (tab === 'pr') return <PRIcon />
  if (tab === 'review') return <ReviewIcon />
  if (tab === 'code') return <CodeIcon />
  const base = getTabBaseType(tab)
  if (base === 'agent') return <TerminalIcon />
  if (base === 'terminal') return <ShellIcon />
  return <TerminalIcon />
}

/* ── Drag & Drop types ────────────────────────────────── */

export interface DragData {
  tab: WorkspaceTab
  sourceColumnId: string
}

export const DRAG_MIME = 'application/x-workspace-tab'

/* ── Column Panel ─────────────────────────────────────── */

export function ColumnPanel({
  column,
  canClose,
  canSplit,
  onSplit,
  disabledTabs,
  disabledTooltip,
  dragOverInfo,
  setDragOverInfo,
  onAddDynamicTab,
  onCloseDynamicTab,
  badge,
}: {
  column: WorkspaceColumnType
  canClose: boolean
  canSplit: boolean
  onSplit: () => void
  disabledTabs?: Set<WorkspaceTab>
  disabledTooltip?: string
  dragOverInfo: { columnId: string; index: number } | null
  setDragOverInfo: (info: { columnId: string; index: number } | null) => void
  onAddDynamicTab: (columnId: string, type: 'agent' | 'terminal') => void
  onCloseDynamicTab: (tab: WorkspaceTab) => void
  badge?: { tab: WorkspaceTab; count: number }
}) {
  const { setActiveTab, closeColumn, moveTab, reorderTab } = useWorkspaceLayoutStore()
  const tabBarRef = useRef<HTMLDivElement>(null)
  const isEmpty = column.tabs.length === 0

  /* ── Drag handlers for the column's tab bar ── */

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_MIME)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'

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

  /* ── Drop handlers for empty column body ── */
  const handleBodyDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_MIME)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setDragOverInfo({ columnId: column.id, index: 0 })
    },
    [column.id, setDragOverInfo]
  )

  const handleBodyDragLeave = useCallback(
    (e: React.DragEvent) => {
      const target = e.currentTarget as HTMLElement
      if (!target.contains(e.relatedTarget as Node)) {
        setDragOverInfo(null)
      }
    },
    [setDragOverInfo]
  )

  const handleBodyDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragOverInfo(null)
      const raw = e.dataTransfer.getData(DRAG_MIME)
      if (!raw) return
      const data: DragData = JSON.parse(raw)
      if (data.sourceColumnId !== column.id) {
        moveTab(data.tab, data.sourceColumnId, column.id, 0)
      }
    },
    [column.id, moveTab, setDragOverInfo]
  )

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
              {isDragOver && dragOverInfo?.index === i && (
                <div className="w-[2px] h-5 bg-accent rounded-full flex-shrink-0" />
              )}
              <DraggableTab
                tab={tab}
                active={tab === column.activeTab}
                disabled={disabledTabs?.has(tab)}
                disabledTooltip={disabledTooltip}
                columnId={column.id}
                closable={isDynamicTab(tab)}
                badge={badge?.tab === tab ? badge.count : undefined}
                onClick={() => setActiveTab(column.id, tab)}
                onClose={() => onCloseDynamicTab(tab)}
              />
            </React.Fragment>
          ))}
          {isDragOver && dragOverInfo?.index === column.tabs.length && (
            <div className="w-[2px] h-5 bg-accent rounded-full flex-shrink-0" />
          )}
        </div>
        <div className="flex items-center flex-shrink-0 gap-0.5" style={{ marginLeft: '4px' }}>
          <AddTabMenu columnId={column.id} onAdd={onAddDynamicTab} />
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

      {/* Custom button toolbar */}
      <CustomButtonBar placement="session-toolbar" />

      {/* Content — portal targets get moved here by parent workspace */}
      {isEmpty ? (
        <div
          className={`flex-1 flex flex-col items-center justify-center min-h-0 relative transition-colors ${
            isDragOver ? 'bg-accent/5' : ''
          }`}
          data-column-content
          onDragOver={handleBodyDragOver}
          onDragLeave={handleBodyDragLeave}
          onDrop={handleBodyDrop}
        >
          <div className="text-text-muted text-xs text-center" style={{ padding: '20px' }}>
            {isDragOver ? (
              <span className="text-accent">Drop tab here</span>
            ) : (
              <span>Drag tabs here</span>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0 relative" data-column-content />
      )}
    </div>
  )
}

/* ── Add Tab Menu ─────────────────────────────────────── */

export function AddTabMenu({
  columnId,
  onAdd,
}: {
  columnId: string
  onAdd: (columnId: string, type: 'agent' | 'terminal') => void
}) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={menuRef} className="relative">
      <IconButton label="Add tab" size="sm" onClick={() => setOpen(!open)}>
        <PlusIcon />
      </IconButton>
      {open && (
        <div
          className="absolute right-0 top-full mt-1 bg-bg-secondary border border-border rounded shadow-lg py-1 min-w-[150px]"
          style={{ zIndex: 50 }}
        >
          <button
            className="flex items-center gap-2 w-full text-left text-xs text-text hover:bg-bg-tertiary transition-colors"
            style={{ padding: '6px 10px' }}
            onClick={() => {
              onAdd(columnId, 'agent')
              setOpen(false)
            }}
          >
            <TerminalIcon />
            New Agent
          </button>
          <button
            className="flex items-center gap-2 w-full text-left text-xs text-text hover:bg-bg-tertiary transition-colors"
            style={{ padding: '6px 10px' }}
            onClick={() => {
              onAdd(columnId, 'terminal')
              setOpen(false)
            }}
          >
            <ShellIcon />
            New Terminal
          </button>
        </div>
      )}
    </div>
  )
}

/* ── Draggable Tab ────────────────────────────────────── */

export function DraggableTab({
  tab,
  active,
  disabled,
  disabledTooltip,
  columnId,
  closable,
  badge,
  onClick,
  onClose,
}: {
  tab: WorkspaceTab
  active: boolean
  disabled?: boolean
  disabledTooltip?: string
  columnId: string
  closable?: boolean
  badge?: number
  onClick: () => void
  onClose?: () => void
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

  const handleClose = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onClose?.()
    },
    [onClose]
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
      className={`flex items-center gap-1.5 text-xs transition-colors relative group
        focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset
        ${disabled
          ? 'text-text-muted/40 cursor-not-allowed'
          : active
            ? 'text-text cursor-grab active:cursor-grabbing'
            : 'text-text-muted hover:text-text cursor-grab active:cursor-grabbing'
        }`}
      style={{ padding: '8px 10px' }}
    >
      {getTabIcon(tab)}
      {getTabLabel(tab)}
      {badge != null && (
        <span className="min-w-[16px] h-[16px] rounded-full bg-warning/20 text-warning text-[10px] font-medium flex items-center justify-center leading-none" style={{ padding: '0 4px' }}>
          {badge}
        </span>
      )}
      {closable && (
        <span
          onClick={handleClose}
          className="ml-0.5 opacity-0 group-hover:opacity-100 hover:text-danger transition-opacity rounded"
          role="button"
          aria-label={`Close ${getTabLabel(tab)}`}
          tabIndex={-1}
        >
          <CloseIcon />
        </span>
      )}
      {active && !disabled && <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent" />}
    </button>
  )

  if (disabled && disabledTooltip) {
    return <Tooltip content={disabledTooltip} side="bottom">{button}</Tooltip>
  }

  return button
}
