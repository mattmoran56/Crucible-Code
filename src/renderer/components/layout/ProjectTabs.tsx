import React, { useEffect, useState } from 'react'
import { useProjectStore } from '../../stores/projectStore'
import { useNotificationStore } from '../../stores/notificationStore'
import { useUpdateStore } from '../../stores/updateStore'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { useSettingsStore } from '../../stores/settingsStore'
import type { Project } from '../../../../shared/types'

export function ProjectTabs() {
  const { projects, activeProjectId, setActiveProject, addProject, removeProject, reorderProjects } =
    useProjectStore()
  const { getPendingCountForProject } = useNotificationStore()
  const { status, log, setStatus, appendLog, reset } = useUpdateStore()
  const { openSettings } = useSettingsStore()

  const [projectToClose, setProjectToClose] = useState<Project | null>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  useEffect(() => {
    const removeStatus = window.api.update.onStatus(setStatus)
    const removeLog = window.api.update.onLog(appendLog)
    return () => { removeStatus(); removeLog() }
  }, [setStatus, appendLog])

  const getPendingCount = getPendingCountForProject

  const handleUpdateClick = () => {
    if (status.state === 'error') {
      reset()
      return
    }
    window.api.update.apply()
  }

  const updateButtonVisible =
    status.state === 'available' || status.state === 'updating' || status.state === 'error'

  const updateButtonLabel = (() => {
    if (status.state === 'available') return `Update Available (${status.commitCount})`
    if (status.state === 'updating') return log.at(-1) ?? 'Updating...'
    if (status.state === 'error') return 'Update failed — dismiss'
    return ''
  })()

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDragIndex(index)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setOverIndex(index)
  }

  const handleDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    if (dragIndex === null || dragIndex === index) {
      setDragIndex(null)
      setOverIndex(null)
      return
    }
    const reordered = [...projects]
    const [moved] = reordered.splice(dragIndex, 1)
    reordered.splice(index, 0, moved)
    reorderProjects(reordered.map((p) => p.id))
    setDragIndex(null)
    setOverIndex(null)
  }

  const handleDragEnd = () => {
    setDragIndex(null)
    setOverIndex(null)
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
      >
        {projects.map((project, index) => {
          const count = getPendingCount(project.id)
          const isActive = project.id === activeProjectId
          const isDraggingOver = overIndex === index && dragIndex !== null && dragIndex !== index
          const isDragging = dragIndex === index

          return (
            <button
              key={project.id}
              role="tab"
              aria-selected={isActive}
              draggable
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDrop={(e) => handleDrop(e, index)}
              onDragEnd={handleDragEnd}
              onClick={() => setActiveProject(project.id)}
              className={[
                'titlebar-no-drag group relative flex items-center h-full w-44 text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset cursor-grab active:cursor-grabbing',
                isActive ? 'bg-bg text-text' : 'text-text-muted hover:text-text hover:bg-bg-secondary',
                isDragging ? 'opacity-50' : '',
                isDraggingOver ? 'ring-l-2 border-l-2 border-accent' : '',
              ].join(' ')}
              style={{ paddingLeft: 16, paddingRight: 32 }}
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
                      onClick={(e) => { e.stopPropagation(); setProjectToClose(project) }}
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
                    onClick={(e) => { e.stopPropagation(); setProjectToClose(project) }}
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
