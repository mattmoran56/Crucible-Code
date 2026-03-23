import React from 'react'
import { useProjectStore } from '../../stores/projectStore'

export function ProjectTabs() {
  const { projects, activeProjectId, setActiveProject, addProject, removeProject } =
    useProjectStore()

  return (
    <div className="titlebar-drag flex h-11 items-center bg-bg-tertiary border-b border-border">
      {/* Reserve space for macOS traffic lights (close/minimize/maximize) */}
      <div className="w-[78px] shrink-0" />

      {/* Tabs — left aligned, uniform width */}
      <div className="flex items-center h-full min-w-0 gap-px">
        {projects.map((project) => (
          <button
            key={project.id}
            onClick={() => setActiveProject(project.id)}
            className={`titlebar-no-drag group relative flex items-center justify-center gap-2 w-44 px-5 h-full text-xs transition-colors ${
              project.id === activeProjectId
                ? 'bg-bg text-text'
                : 'text-text-muted hover:text-text hover:bg-bg-secondary'
            }`}
          >
            <span className="truncate">{project.name}</span>
            <span
              onClick={(e) => {
                e.stopPropagation()
                removeProject(project.id)
              }}
              className="opacity-0 group-hover:opacity-100 hover:text-danger text-[10px] absolute right-2"
            >
              ×
            </span>
            {/* Active indicator underline */}
            {project.id === activeProjectId && (
              <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent" />
            )}
          </button>
        ))}
      </div>

      {/* Spacer — draggable area fills the middle */}
      <div className="flex-1" />

      {/* Add project — right aligned with padding */}
      <button
        onClick={addProject}
        className="titlebar-no-drag px-5 py-1.5 mr-4 rounded text-xs text-text-muted hover:text-text hover:bg-bg-secondary border border-border transition-colors"
        title="Add project"
      >
        Add Project
      </button>
    </div>
  )
}
