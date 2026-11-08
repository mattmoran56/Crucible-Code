import React from 'react'
import type { Project } from '../../../shared/types'
import { Button } from '../ui/Button'

interface Props {
  projects: Project[]
  onSetHidden: (projectId: string, hidden: boolean) => void
}

/**
 * Every registered project with a Hide / Unhide toggle. Hidden projects keep
 * their sessions and settings; they just aren't shown as a tab.
 */
export function ProjectVisibilitySettings({ projects, onSetHidden }: Props) {
  const hidden = projects.filter((p) => p.hidden)
  const shown = projects.filter((p) => !p.hidden)

  if (projects.length === 0) {
    return <p className="text-xs text-text-muted">No projects yet.</p>
  }

  return (
    <div className="flex flex-col gap-5">
      <ProjectList
        title="Hidden"
        empty="No hidden projects. Right-click a project tab and choose Hide Project to hide it."
        projects={hidden}
        actionLabel="Unhide"
        onAction={(id) => onSetHidden(id, false)}
      />
      <ProjectList
        title="Shown as tabs"
        empty="Every project is hidden."
        projects={shown}
        actionLabel="Hide"
        onAction={(id) => onSetHidden(id, true)}
      />
    </div>
  )
}

function ProjectList({
  title,
  empty,
  projects,
  actionLabel,
  onAction,
}: {
  title: string
  empty: string
  projects: Project[]
  actionLabel: string
  onAction: (projectId: string) => void
}) {
  return (
    <section aria-label={`${title} projects`}>
      <h2
        className="text-[11px] font-medium text-text-muted uppercase tracking-wide"
        style={{ marginBottom: 8 }}
      >
        {title} ({projects.length})
      </h2>
      {projects.length === 0 ? (
        <p className="text-xs text-text-muted">{empty}</p>
      ) : (
        <ul className="border border-border rounded-md divide-y divide-border">
          {projects.map((p) => (
            <li key={p.id} className="flex items-center gap-3" style={{ padding: '8px 12px' }}>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-text truncate">{p.name}</p>
                <p className="text-[11px] text-text-muted truncate" title={p.repoPath}>
                  {p.repoPath}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="border border-border shrink-0"
                aria-label={`${actionLabel} ${p.name}`}
                onClick={() => onAction(p.id)}
              >
                {actionLabel}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
