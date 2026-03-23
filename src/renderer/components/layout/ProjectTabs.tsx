import React from 'react'
import { useProjectStore } from '../../stores/projectStore'
import { TabBar, Tab } from '../ui/TabBar'
import { IconButton } from '../ui/IconButton'
import { Button } from '../ui/Button'

export function ProjectTabs() {
  const { projects, activeProjectId, setActiveProject, addProject, removeProject } =
    useProjectStore()

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
