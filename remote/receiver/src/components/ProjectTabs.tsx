interface Project {
  id: string
  name: string
}

interface Props {
  projects: Project[]
  activeProjectId: string | null
  onSelect: (projectId: string) => void
}

export function ProjectTabs({ projects, activeProjectId, onSelect }: Props) {
  return (
    <div className="flex items-center h-full">
      {/* Left gutter — mirrors the desktop's traffic-light spacer so the first tab doesn't butt up against the edge */}
      <div className="w-3 shrink-0" />
      <div
        role="tablist"
        aria-label="Projects"
        className="flex items-center h-full gap-px min-w-0"
      >
        {projects.map((project) => {
          const isActive = project.id === activeProjectId
          return (
            <button
              key={project.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => onSelect(project.id)}
              className={
                'relative flex items-center h-full w-44 text-xs transition-colors ' +
                (isActive
                  ? 'bg-bg text-text'
                  : 'text-text-muted hover:text-text hover:bg-bg-secondary')
              }
              style={{ paddingLeft: 16, paddingRight: 32 }}
            >
              <span className="truncate min-w-0">{project.name}</span>
              {isActive && (
                <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent" />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
