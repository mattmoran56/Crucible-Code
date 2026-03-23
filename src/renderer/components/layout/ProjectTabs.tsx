import React from 'react'
import { useProjectStore } from '../../stores/projectStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useNotificationStore } from '../../stores/notificationStore'
import { TabBar, Tab } from '../ui/TabBar'
import { IconButton } from '../ui/IconButton'
import { Button } from '../ui/Button'

export function ProjectTabs() {
  const { projects, activeProjectId, setActiveProject, addProject, removeProject } =
    useProjectStore()
  const { sessions } = useSessionStore()
  const { pendingSessionIds } = useNotificationStore()

  const getPendingCount = (projectId: string) =>
    sessions.filter((s) => s.projectId === projectId && pendingSessionIds.has(s.id)).length

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

      {/* Add project — right aligned */}
      <Button
        variant="ghost"
        size="sm"
        onClick={addProject}
        className="titlebar-no-drag border border-border"
        style={{ padding: '8px 20px', marginRight: '20px' }}
        title="Add project"
      >
        Add Project
      </Button>
    </div>
  )
}
