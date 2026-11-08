import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useProjectStore, selectTabProjects } from '../../stores/projectStore'
import { useNotificationStore } from '../../stores/notificationStore'
import { useUpdateStore } from '../../stores/updateStore'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { useSettingsStore } from '../../stores/settingsStore'
import { CustomButtonBar } from '../buttons/CustomButtonBar'
import { RemoteTogglePopover } from './RemoteTogglePopover'
import { useContextMenu, type ContextMenuItem } from '../ui/ContextMenu'
import {
  DEFAULT_TAB_STRIP,
  DRAG_START_DISTANCE,
  insertionIndex,
  placeAt,
  type TabStripGeometry,
} from '../../../shared/tab-drag'
import type { Project, WindowSummary } from '../../../shared/types'

/** A press on a tab, which becomes a drag once the pointer moves a few px. */
interface Press {
  pointerId: number
  projectId: string
  startX: number
  startY: number
  /** Where in the tab the pointer pressed. */
  grabX: number
  grabY: number
  dragging: boolean
}

/**
 * Where this window's tabs sit, in window (client) coordinates. Uses layout
 * sizes rather than rects so the dragged tab's transform doesn't skew it.
 */
function measureStrip(tablist: HTMLElement): TabStripGeometry {
  const list = tablist.getBoundingClientRect()
  const strip = (tablist.parentElement ?? tablist).getBoundingClientRect()
  const first = tablist.querySelector<HTMLElement>('[role="tab"]')
  const tabWidth = first?.offsetWidth || DEFAULT_TAB_STRIP.tabWidth
  const gap = parseFloat(getComputedStyle(tablist).columnGap) || 0
  return {
    left: list.left,
    top: strip.top,
    height: strip.height || DEFAULT_TAB_STRIP.height,
    tabWidth,
    slot: tabWidth + gap,
  }
}

function windowLabel(w: WindowSummary, projects: Project[]): string {
  const names = w.projectIds
    .map((id) => projects.find((p) => p.id === id)?.name)
    .filter(Boolean) as string[]
  if (names.length === 0) return 'Empty window'
  return names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} +${names.length - 3}`
}

export function ProjectTabs() {
  const {
    projects,
    activeProjectId,
    windowId,
    tabIds,
    setActiveProject,
    addProject,
    removeProject,
    reorderTabs,
    closeTab,
    setProjectHidden,
  } = useProjectStore()
  const tabs = selectTabProjects({ projects, windowId, tabIds })
  const { getNotificationCountForProject } = useNotificationStore()
  const { status, log, setStatus, appendLog, reset } = useUpdateStore()
  const { openSettings } = useSettingsStore()

  const [projectToClose, setProjectToClose] = useState<Project | null>(null)
  const { onContextMenu, menu } = useContextMenu()
  const multiWindow = !!windowId && !!window.api?.windows

  // ── Tab dragging ──────────────────────────────────────────────────────
  // Pointer-driven, like Chrome. With a window manager the drag is handed to
  // main once it starts (it reorders, tears the tab off into a new window and
  // moves it between windows); this window only holds pointer capture on the
  // tab list — which stays mounted even when the tab leaves — and reports
  // release / Escape. Without one (mock app, tests) tabs reorder locally.
  const tablistRef = useRef<HTMLDivElement>(null)
  const press = useRef<Press | null>(null)
  const stopPress = useRef<((cancel: boolean) => void) | null>(null)
  const suppressClick = useRef(false)
  /** The tab being dragged in this window and its left edge (client x), for following the pointer. */
  const [dragging, setDragging] = useState<{ projectId: string; left: number } | null>(null)
  /** Local-only reorder preview (no window manager). */
  const [preview, setPreview] = useState<string[] | null>(null)
  const previewRef = useRef<string[] | null>(null)
  const tabIdsRef = useRef<string[]>([])
  tabIdsRef.current = tabs.map((p) => p.id)

  const shownTabs = preview
    ? (preview.map((id) => tabs.find((p) => p.id === id)).filter(Boolean) as Project[])
    : tabs

  // Tell main where this window's tabs are, so it can hit-test drags.
  const tabKey = tabIdsRef.current.join('\n')
  useLayoutEffect(() => {
    const el = tablistRef.current
    if (!multiWindow || !el) return
    const report = () => void window.api.windows.reportTabStrip?.(measureStrip(el))?.catch?.(() => {})
    report()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(report) : null
    ro?.observe(el)
    window.addEventListener('resize', report)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', report)
    }
  }, [multiWindow, tabKey])

  // Unmounting mid-drag: let go cleanly.
  useEffect(() => () => stopPress.current?.(true), [])

  const handleTabPointerDown = (e: React.PointerEvent<HTMLButtonElement>, project: Project) => {
    if (e.button !== 0 || press.current) return
    if ((e.target as HTMLElement).closest('[role="button"]')) return // the close (×) control
    const rect = e.currentTarget.getBoundingClientRect()
    press.current = {
      pointerId: e.pointerId,
      projectId: project.id,
      startX: e.clientX,
      startY: e.clientY,
      grabX: e.clientX - rect.left,
      grabY: e.clientY - rect.top,
      dragging: false,
    }
    const viaMain = multiWindow
    const tablist = tablistRef.current

    const onMove = (ev: PointerEvent) => {
      const p = press.current
      if (!p || ev.pointerId !== p.pointerId) return
      if (!p.dragging) {
        if (Math.hypot(ev.clientX - p.startX, ev.clientY - p.startY) < DRAG_START_DISTANCE) return
        p.dragging = true
        // Keep getting the pointer — and its release — even outside the window.
        try { tablist?.setPointerCapture(ev.pointerId) } catch { /* pointer already gone */ }
        if (viaMain) {
          void window.api.windows.tabDragStart(p.projectId, { x: p.grabX, y: p.grabY })?.catch?.(() => {})
        } else {
          previewRef.current = tabIdsRef.current
          setPreview(tabIdsRef.current)
          setActiveProject(p.projectId)
        }
      }
      setDragging({ projectId: p.projectId, left: ev.clientX - p.grabX })
      if (!viaMain && tablist) {
        const order = previewRef.current ?? tabIdsRef.current
        const index = insertionIndex(ev.clientX - p.grabX, order.length - 1, measureStrip(tablist))
        const next = placeAt(order, p.projectId, index)
        if (next.join() !== order.join()) {
          previewRef.current = next
          setPreview(next)
        }
      }
    }
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId === press.current?.pointerId) stop(false, ev.altKey)
    }
    const onCancel = (ev: PointerEvent) => {
      if (ev.pointerId === press.current?.pointerId) stop(true, false)
    }
    // Capture lost without a pointerup (e.g. the OS took the mouse): treat as a drop.
    const onLostCapture = () => stop(false, false)
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || !press.current?.dragging) return
      ev.preventDefault()
      ev.stopPropagation()
      stop(true, false)
    }

    const stop = (cancel: boolean, copy: boolean) => {
      const p = press.current
      press.current = null
      stopPress.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('keydown', onKey, true)
      tablist?.removeEventListener('lostpointercapture', onLostCapture)
      if (!p?.dragging) return
      // The click that follows a drag must not re-select a tab.
      suppressClick.current = true
      setTimeout(() => { suppressClick.current = false }, 0)
      try { tablist?.releasePointerCapture(p.pointerId) } catch { /* already released */ }
      setDragging(null)
      if (viaMain) {
        void window.api.windows.tabDragEnd({ cancel, copy })?.catch?.(() => {})
        return
      }
      const order = previewRef.current
      previewRef.current = null
      setPreview(null)
      if (!cancel && order && order.join() !== tabIdsRef.current.join()) void reorderTabs(order)
    }
    stopPress.current = (cancel) => stop(cancel, false)

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onKey, true)
    tablist?.addEventListener('lostpointercapture', onLostCapture)
  }

  /** Horizontal offset that keeps the dragged tab under the pointer, clamped to the strip. */
  const dragOffset = (index: number): number => {
    const el = tablistRef.current
    if (!dragging || !el) return 0
    const g = measureStrip(el)
    const maxLeft = g.left + Math.max(0, shownTabs.length - 1) * g.slot
    const left = Math.max(g.left, Math.min(maxLeft, dragging.left))
    return left - (g.left + index * g.slot)
  }

  useEffect(() => {
    const removeStatus = window.api.update.onStatus(setStatus)
    const removeLog = window.api.update.onLog(appendLog)
    return () => { removeStatus(); removeLog() }
  }, [setStatus, appendLog])

  const getPendingCount = getNotificationCountForProject

  const handleUpdateClick = async () => {
    if (status.state === 'error') {
      reset()
      return
    }
    const builtCommit = await window.api.update.apply()
    setStatus({ state: 'updating', builtCommit })
  }

  const updateButtonVisible =
    status.state === 'available' || status.state === 'updating' || status.state === 'error'

  const updateButtonLabel = (() => {
    if (status.state === 'available') return `Update Available (${status.commitCount})`
    if (status.state === 'updating') return log.at(-1) ?? 'Updating...'
    if (status.state === 'error') return 'Update failed — dismiss'
    return ''
  })()

  /** Close the tab here if another window still shows the project; otherwise offer to remove it. */
  const requestClose = async (project: Project) => {
    if (multiWindow) {
      try {
        const all = await window.api.windows.list()
        const elsewhere = all.some((w) => !w.isCurrent && w.projectIds.includes(project.id))
        if (elsewhere) {
          closeTab(project.id)
          return
        }
      } catch {
        // Fall through to the remove dialog.
      }
    }
    setProjectToClose(project)
  }

  const handleTabContextMenu = async (e: React.MouseEvent, project: Project) => {
    e.preventDefault()
    e.stopPropagation()
    const { clientX, clientY } = e
    const projectItems: ContextMenuItem[] = [
      {
        label: 'Hide Project',
        onClick: () => void setProjectHidden(project.id, true),
      },
      {
        label: 'Remove Project…',
        variant: 'danger' as const,
        onClick: () => setProjectToClose(project),
      },
    ]
    if (!multiWindow) {
      onContextMenu(
        { clientX, clientY, preventDefault: () => {}, stopPropagation: () => {} } as React.MouseEvent,
        projectItems
      )
      return
    }
    let others: WindowSummary[] = []
    let openElsewhere = false
    try {
      const all = await window.api.windows.list()
      others = all.filter((w) => !w.isCurrent)
      openElsewhere = others.some((w) => w.projectIds.includes(project.id))
    } catch {
      others = []
    }
    const items: ContextMenuItem[] = [
      {
        label: 'Move to New Window',
        onClick: () => void window.api.windows.openProject(project.id, 'move'),
        disabled: tabs.length <= 1,
      },
      {
        label: 'Duplicate in New Window',
        onClick: () => void window.api.windows.openProject(project.id, 'copy'),
        separatorAfter: others.length === 0,
      },
      ...others.map((w, i) => ({
        label: `Move to Window: ${windowLabel(w, projects)}`,
        onClick: () => void window.api.windows.sendTab(project.id, w.windowId),
        separatorAfter: i === others.length - 1,
      })),
      ...(openElsewhere ? [{ label: 'Close Tab', onClick: () => closeTab(project.id) }] : []),
      ...projectItems,
    ]
    onContextMenu(
      { clientX, clientY, preventDefault: () => {}, stopPropagation: () => {} } as React.MouseEvent,
      items
    )
  }

  return (
    <div className="titlebar-drag flex h-11 items-center bg-bg-tertiary border-b border-border">
      {/* Reserve space for macOS traffic lights */}
      <div className="w-[78px] shrink-0" />

      {/* Tab list */}
      <div
        role="tablist"
        aria-label="Projects"
        aria-orientation="horizontal"
        ref={tablistRef}
        className="titlebar-no-drag flex items-center h-full gap-px min-w-0"
      >
        {shownTabs.map((project, index) => {
          const count = getPendingCount(project.id)
          const isActive = project.id === activeProjectId
          const isDragging = dragging?.projectId === project.id

          return (
            <button
              key={project.id}
              role="tab"
              aria-selected={isActive}
              onPointerDown={(e) => handleTabPointerDown(e, project)}
              onClick={() => {
                if (suppressClick.current) return
                setActiveProject(project.id)
              }}
              onContextMenu={(e) => void handleTabContextMenu(e, project)}
              title={multiWindow ? `${project.name} — drag to reorder, out to open in a new window, or onto another window` : project.name}
              className={[
                'titlebar-no-drag group relative flex items-center h-full w-44 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset select-none',
                isActive ? 'bg-bg text-text' : 'text-text-muted hover:text-text hover:bg-bg-secondary',
                isDragging ? 'z-10 shadow-md cursor-grabbing' : 'transition-colors',
              ].join(' ')}
              style={{
                paddingLeft: 16,
                paddingRight: 32,
                transform: isDragging ? `translateX(${dragOffset(index)}px)` : undefined,
              }}
            >
              <span className="truncate min-w-0">{project.name}</span>

              {/* Right slot: badge or X, share same position */}
              <span className="absolute right-2 flex items-center justify-center w-4 h-4">
                {count > 0 ? (
                  <>
                    {/* Badge — hidden on hover */}
                    <span className="group-hover:hidden min-w-[16px] h-4 px-1 rounded-full bg-warning text-bg text-[10px] font-bold flex items-center justify-center leading-none">
                      {count}
                    </span>
                    {/* X — shown on hover */}
                    <span
                      role="button"
                      aria-label={`Close ${project.name}`}
                      tabIndex={-1}
                      onClick={(e) => { e.stopPropagation(); void requestClose(project) }}
                      className="hidden group-hover:flex items-center justify-center w-4 h-4 text-[12px] hover:text-danger cursor-pointer"
                    >
                      ×
                    </span>
                  </>
                ) : (
                  /* X — shown on hover only */
                  <span
                    role="button"
                    aria-label={`Close ${project.name}`}
                    tabIndex={-1}
                    onClick={(e) => { e.stopPropagation(); void requestClose(project) }}
                    className="opacity-0 group-hover:opacity-100 flex items-center justify-center w-4 h-4 text-[12px] hover:text-danger cursor-pointer"
                  >
                    ×
                  </span>
                )}
              </span>

              {isActive && (
                <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent" />
              )}
            </button>
          )
        })}
      </div>

      {/* Spacer — draggable area fills the middle */}
      <div className="flex-1" />

      {/* Update available */}
      {updateButtonVisible && (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleUpdateClick}
          disabled={status.state === 'updating'}
          className={[
            'titlebar-no-drag border',
            status.state === 'error' ? 'border-danger text-danger' : 'border-warning text-warning',
          ].join(' ')}
          style={{ padding: '8px 16px', marginRight: '8px', maxWidth: '260px' }}
          title={updateButtonLabel}
        >
          <span className="truncate">{updateButtonLabel}</span>
        </Button>
      )}

      {/* Custom buttons (project-tabs placement) */}
      <CustomButtonBar placement="project-tabs" />

      <RemoteTogglePopover />

      {/* Add project + Settings */}
      <Button
        variant="ghost"
        size="sm"
        onClick={addProject}
        className="titlebar-no-drag border border-border"
        style={{ padding: '8px 20px' }}
        title="Add project"
      >
        Add Project
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={openSettings}
        className="titlebar-no-drag border border-border"
        style={{ padding: '8px', marginLeft: 6, marginRight: 20 }}
        title="Settings"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </Button>

      {menu}

      {/* Close project confirm dialog */}
      <Dialog
        open={!!projectToClose}
        onClose={() => setProjectToClose(null)}
        title="Close project"
      >
        <p className="text-sm text-text-muted mb-4">
          Remove <span className="text-text font-medium">{projectToClose?.name}</span> from Crucible Code?
        </p>
        <p className="text-xs text-text-muted mb-4">
          Or hide it to just close the tab — its sessions and settings stay, and you can unhide it in Settings → Projects.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setProjectToClose(null)}>
            Cancel
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="border border-border"
            onClick={() => {
              if (projectToClose) void setProjectHidden(projectToClose.id, true)
              setProjectToClose(null)
            }}
          >
            Hide
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              if (projectToClose) removeProject(projectToClose.id)
              setProjectToClose(null)
            }}
          >
            Remove
          </Button>
        </div>
      </Dialog>
    </div>
  )
}
