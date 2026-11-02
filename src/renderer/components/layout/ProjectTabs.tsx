import React, { useEffect, useRef, useState } from 'react'
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
  PROJECT_TAB_MIME,
  moveToInsertionPoint,
  parseTabDragPayload,
} from '../../lib/tabOrder'
import type { Project, WindowSummary } from '../../../shared/types'

/** The tab drag that started in this window, if any. */
interface LocalDrag {
  token: string
  projectId: string
  index: number
  /** Set when the drop landed on this window's own tab strip (a reorder). */
  handledLocally: boolean
}

/** Insertion point (0..n) for a drag over tab `index`: before it, or after it past its midpoint. */
function insertionIndex(e: React.DragEvent, index: number): number {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  return e.clientX > rect.left + rect.width / 2 ? index + 1 : index
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
  } = useProjectStore()
  const tabs = selectTabProjects({ projects, windowId, tabIds })
  const { getNotificationCountForProject } = useNotificationStore()
  const { status, log, setStatus, appendLog, reset } = useUpdateStore()
  const { openSettings } = useSettingsStore()

  const [projectToClose, setProjectToClose] = useState<Project | null>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  /** Insertion point (0..tabs.length) under a tab drag, from this or another window. */
  const [overIndex, setOverIndex] = useState<number | null>(null)
  const localDrag = useRef<LocalDrag | null>(null)
  const { onContextMenu, menu } = useContextMenu()
  const multiWindow = !!windowId && !!window.api?.windows

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

  const resetDrag = () => {
    setDragIndex(null)
    setOverIndex(null)
  }

  const handleDragStart = (e: React.DragEvent, index: number, project: Project) => {
    const token = crypto.randomUUID()
    localDrag.current = { token, projectId: project.id, index, handledLocally: false }
    setDragIndex(index)
    e.dataTransfer.effectAllowed = 'copyMove'
    // Custom MIME so the tab can be dropped on another window's tab strip, and
    // so editors/terminals don't treat it as text.
    e.dataTransfer.setData(
      PROJECT_TAB_MIME,
      JSON.stringify({ token, projectId: project.id, fromWindowId: windowId })
    )
  }

  const isTabDrag = (e: React.DragEvent) =>
    localDrag.current !== null || Array.from(e.dataTransfer.types).includes(PROJECT_TAB_MIME)

  const handleDragOver = (e: React.DragEvent, index: number) => {
    if (!isTabDrag(e)) return
    e.preventDefault()
    e.stopPropagation()
    // Option/Alt-drag into another window keeps the tab here too.
    e.dataTransfer.dropEffect = !localDrag.current && e.altKey ? 'copy' : 'move'
    setOverIndex(insertionIndex(e, index))
  }

  const handleDrop = (e: React.DragEvent, index: number) => {
    if (!isTabDrag(e)) return
    e.preventDefault()
    e.stopPropagation()
    const insertAt = insertionIndex(e, index)
    const local = localDrag.current
    if (local) {
      // Reorder within this window.
      local.handledLocally = true
      const ids = tabs.map((p) => p.id)
      const from = ids.indexOf(local.projectId)
      if (from >= 0) {
        const reordered = moveToInsertionPoint(ids, from, insertAt)
        if (reordered.join() !== ids.join()) void reorderTabs(reordered)
      }
      resetDrag()
      return
    }
    // A tab dragged in from another window.
    const payload = parseTabDragPayload(e.dataTransfer.getData(PROJECT_TAB_MIME))
    resetDrag()
    if (!payload || !payload.fromWindowId || !multiWindow) return
    void window.api.windows.moveTab(payload.token, payload.projectId, payload.fromWindowId, insertAt, e.altKey)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    // Only clear when leaving the strip, not when moving between tabs.
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOverIndex(null)
  }

  const handleDragEnd = (e: React.DragEvent) => {
    const local = localDrag.current
    localDrag.current = null
    resetDrag()
    if (!local || local.handledLocally || !multiWindow) return
    // Dropped somewhere other than this window's tab strip: another window's
    // strip (it reports the drop), over another window, or outside every
    // window — which tears the tab off into a new window.
    void window.api.windows.tabDragEnd(local.token, local.projectId, e.altKey)
  }

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
    if (!multiWindow) return
    e.preventDefault()
    e.stopPropagation()
    const { clientX, clientY } = e
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
        label: 'Open in Another Window',
        onClick: () => void window.api.windows.openProject(project.id, 'copy'),
        separatorAfter: others.length === 0,
      },
      ...others.map((w, i) => ({
        label: `Move to Window: ${windowLabel(w, projects)}`,
        onClick: () => void window.api.windows.sendTab(project.id, w.windowId),
        separatorAfter: i === others.length - 1,
      })),
      ...(openElsewhere ? [{ label: 'Close Tab', onClick: () => closeTab(project.id) }] : []),
      {
        label: 'Remove Project…',
        variant: 'danger' as const,
        onClick: () => setProjectToClose(project),
      },
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
        className="flex items-center h-full gap-px min-w-0"
        onDragLeave={handleDragLeave}
      >
        {tabs.map((project, index) => {
          const count = getPendingCount(project.id)
          const isActive = project.id === activeProjectId
          const isDragging = dragIndex === index
          // Drop indicator: a bar on the tab's left edge, or the last tab's right edge.
          const showBefore =
            overIndex === index && !(dragIndex !== null && (dragIndex === index || dragIndex === index - 1))
          const showAfter =
            index === tabs.length - 1 && overIndex === tabs.length && dragIndex !== tabs.length - 1

          return (
            <button
              key={project.id}
              role="tab"
              aria-selected={isActive}
              draggable
              onDragStart={(e) => handleDragStart(e, index, project)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDrop={(e) => handleDrop(e, index)}
              onDragEnd={handleDragEnd}
              onClick={() => setActiveProject(project.id)}
              onContextMenu={(e) => void handleTabContextMenu(e, project)}
              title={multiWindow ? `${project.name} — drag out to open in a new window` : project.name}
              className={[
                'titlebar-no-drag group relative flex items-center h-full w-44 text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset cursor-grab active:cursor-grabbing',
                isActive ? 'bg-bg text-text' : 'text-text-muted hover:text-text hover:bg-bg-secondary',
                isDragging ? 'opacity-50' : '',
              ].join(' ')}
              style={{ paddingLeft: 16, paddingRight: 32 }}
            >
              {showBefore && (
                <span aria-hidden className="absolute left-0 top-1 bottom-1 w-[2px] bg-accent pointer-events-none" />
              )}
              {showAfter && (
                <span aria-hidden className="absolute right-0 top-1 bottom-1 w-[2px] bg-accent pointer-events-none" />
              )}
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
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setProjectToClose(null)}>
            Cancel
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
