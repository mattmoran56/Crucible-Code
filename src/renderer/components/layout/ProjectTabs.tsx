import React, { useEffect } from 'react'
import { useProjectStore } from '../../stores/projectStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useNotificationStore } from '../../stores/notificationStore'
import { useUpdateStore } from '../../stores/updateStore'
import { TabBar, Tab } from '../ui/TabBar'
import { IconButton } from '../ui/IconButton'
import { Button } from '../ui/Button'
import { useSettingsStore } from '../../stores/settingsStore'

export function ProjectTabs() {
  const { projects, activeProjectId, setActiveProject, addProject, removeProject } =
    useProjectStore()
  const { sessions } = useSessionStore()
  const { pendingSessionIds } = useNotificationStore()
  const { status, log, setStatus, appendLog, reset } = useUpdateStore()
  const { openSettings } = useSettingsStore()

  useEffect(() => {
    const removeStatus = window.api.update.onStatus(setStatus)
    const removeLog = window.api.update.onLog(appendLog)
    return () => { removeStatus(); removeLog() }
  }, [setStatus, appendLog])

  const getPendingCount = (projectId: string) =>
    sessions.filter((s) => s.projectId === projectId && pendingSessionIds.has(s.id)).length

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

  return (
    <div className="titlebar-drag flex h-11 items-center bg-bg-tertiary border-b border-border">
      {/* Reserve space for macOS traffic lights (close/minimize/maximize) */}
      <div className="w-[78px] shrink-0" />

      {/* Tabs — left aligned, uniform width */}
      <TabBar label="Projects" className="gap-px min-w-0">
        {projects.map((project) => (
          <Tab
            key={project.id}
            active={project.id === activeProjectId}
            onClick={() => setActiveProject(project.id)}
            className="titlebar-no-drag group w-44 px-5"
          >
            <span className="truncate">{project.name}</span>
            {(() => {
              const count = getPendingCount(project.id)
              return count > 0 ? (
                <span className="shrink-0 min-w-[16px] h-4 px-1 ml-2 rounded-full bg-warning text-bg text-[10px] font-bold flex items-center justify-center leading-none">
                  {count}
                </span>
              ) : null
            })()}
            <IconButton
              label={`Close ${project.name}`}
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                removeProject(project.id)
              }}
              className="opacity-0 group-hover:opacity-100 hover:!text-danger absolute right-2"
            >
              <span className="text-[10px]">×</span>
            </IconButton>
          </Tab>
        ))}
      </TabBar>

      {/* Spacer — draggable area fills the middle */}
      <div className="flex-1" />

      {/* Update available — shown when new commits detected */}
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

      {/* Add project + Settings — right aligned */}
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
    </div>
  )
}
