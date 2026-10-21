import React from 'react'
import { useProjectStore } from '../../stores/projectStore'
import type { Project, SessionLocation } from '../../../shared/types'
import { ToggleGroup } from '../ui/ToggleGroup'

const LOCATION_OPTIONS: { value: SessionLocation; label: string }[] = [
  { value: 'cloud', label: 'Cloud' },
  { value: 'local', label: 'Local' },
]

/**
 * Per-project "Default session location" card for Settings → Project Defaults.
 * An unset `defaultSessionLocation` means Cloud — new sessions start in
 * Claude Code on the web unless the project opts into Local.
 */
export function SessionLocationSetting({ project }: { project: Project }) {
  const updateProject = useProjectStore((s) => s.updateProject)
  const value: SessionLocation = project.defaultSessionLocation ?? 'cloud'

  const handleChange = async (next: SessionLocation) => {
    if (next === value) return
    await updateProject({ ...project, defaultSessionLocation: next })
  }

  return (
    <div className="border border-border rounded-md" style={{ padding: '12px 14px' }}>
      <div className="flex items-center justify-between gap-3" style={{ marginBottom: 6 }}>
        <div>
          <p className="text-xs font-medium text-text">Default session location</p>
          <p className="text-[11px] text-text-muted">
            Where new sessions for this project start.
          </p>
        </div>
        <ToggleGroup options={LOCATION_OPTIONS} value={value} onChange={handleChange} className="shrink-0" />
      </div>
      <p className="text-[11px] text-text-muted" style={{ marginTop: 8 }}>
        New sessions start in Claude Code on the web by default and can be teleported down to the
        local worktree from the Agent tab. Cloud sessions need a claude.ai login and the repo on
        GitHub with the Claude GitHub App installed; the session&apos;s branch is pushed to GitHub
        when a cloud session starts.
      </p>
    </div>
  )
}
