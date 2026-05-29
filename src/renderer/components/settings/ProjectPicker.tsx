import React from 'react'
import type { Project } from '../../../shared/types'

interface Props {
  projects: Project[]
  value: string
  onChange: (projectId: string) => void
  includeDefault?: boolean
  defaultLabel?: string
  className?: string
}

export function ProjectPicker({
  projects,
  value,
  onChange,
  includeDefault,
  defaultLabel = 'Default (all projects)',
  className,
}: Props) {
  return (
    <div
      className={`flex items-center gap-2 border border-border rounded-md bg-bg-secondary ${className ?? ''}`}
      style={{ padding: '8px 12px', marginBottom: 16 }}
    >
      <span className="text-[11px] font-medium text-text-muted uppercase tracking-wide">
        Project
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 bg-bg border border-border rounded-md text-xs text-text focus:outline-none focus:border-accent"
        style={{ padding: '6px 10px' }}
      >
        {includeDefault && <option value="__default__">{defaultLabel}</option>}
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </div>
  )
}
