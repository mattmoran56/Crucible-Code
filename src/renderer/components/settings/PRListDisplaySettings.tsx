import React, { useEffect, useState } from 'react'
import type { Project, PRLabel } from '../../../shared/types'
import {
  DEFAULT_PR_LIST_DISPLAY,
  PR_LIST_FIELDS,
  type PRListDisplay,
  type PRListField,
  type PRLabelFilter,
} from '../../../shared/prDisplay'
import { usePRListDisplayStore } from '../../stores/prListDisplayStore'
import { Button } from '../ui/Button'
import { ToggleGroup } from '../ui/ToggleGroup'
import { PRLabelChip } from '../pullrequests/PRLabelChip'

interface Props {
  projects: Project[]
}

export function PRListDisplaySettings({ projects }: Props) {
  const defaultDisplay = usePRListDisplayStore((s) => s.default)
  const byRepo = usePRListDisplayStore((s) => s.byRepo)
  const setDefault = usePRListDisplayStore((s) => s.setDefault)
  const setForRepo = usePRListDisplayStore((s) => s.setForRepo)
  const resetForRepo = usePRListDisplayStore((s) => s.resetForRepo)
  const hasOverride = usePRListDisplayStore((s) => s.hasOverride)

  // Local cache of fetched repo labels per repoPath. Loaded lazily when a card
  // expands its label picker.
  const [labelsByRepo, setLabelsByRepo] = useState<Record<string, PRLabel[]>>({})
  const [loadingLabels, setLoadingLabels] = useState<Record<string, boolean>>({})

  // Default-card label picker — uses the union of known repo labels (keyed by
  // any repos we've already loaded). If none have loaded, the picker shows
  // only the labels already chosen.
  const knownLabelsForDefault: PRLabel[] = (() => {
    const seen = new Map<string, PRLabel>()
    for (const list of Object.values(labelsByRepo)) {
      for (const l of list) if (!seen.has(l.name)) seen.set(l.name, l)
    }
    return Array.from(seen.values())
  })()

  return (
    <div style={{ marginTop: 40 }}>
      <h1 className="text-lg font-semibold text-text" style={{ marginBottom: 4 }}>
        Pull Request List
      </h1>
      <p className="text-xs text-text-muted" style={{ marginBottom: 20 }}>
        Choose which details show on each PR in the sidebar. Set a default and override per project.
      </p>

      <DisplayCard
        title="Default"
        description="Applied to projects without their own settings."
        display={defaultDisplay}
        onChange={setDefault}
        knownLabels={knownLabelsForDefault}
      />

      {projects.length > 0 && (
        <div className="flex flex-col gap-2" style={{ marginTop: 12 }}>
          {projects.map((project) => {
            const override = byRepo[project.repoPath]
            const display = override ?? defaultDisplay
            const customized = hasOverride(project.repoPath)
            return (
              <DisplayCard
                key={project.id}
                title={project.name}
                description={project.repoPath}
                customized={customized}
                display={display}
                onChange={(next) => setForRepo(project.repoPath, next)}
                onReset={customized ? () => resetForRepo(project.repoPath) : undefined}
                onRequestLabels={() => {
                  if (labelsByRepo[project.repoPath] || loadingLabels[project.repoPath]) return
                  setLoadingLabels((m) => ({ ...m, [project.repoPath]: true }))
                  window.api.github
                    .listRepoLabels(project.repoPath)
                    .then((labels) => {
                      setLabelsByRepo((m) => ({ ...m, [project.repoPath]: labels }))
                    })
                    .finally(() => {
                      setLoadingLabels((m) => ({ ...m, [project.repoPath]: false }))
                    })
                }}
                knownLabels={labelsByRepo[project.repoPath] ?? []}
                loadingLabels={loadingLabels[project.repoPath] ?? false}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

interface DisplayCardProps {
  title: string
  description: string
  display: PRListDisplay
  onChange: (next: PRListDisplay) => void
  customized?: boolean
  onReset?: () => void
  onRequestLabels?: () => void
  knownLabels: PRLabel[]
  loadingLabels?: boolean
}

function DisplayCard({
  title,
  description,
  display,
  onChange,
  customized,
  onReset,
  onRequestLabels,
  knownLabels,
  loadingLabels,
}: DisplayCardProps) {
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (expanded && display.fields.labels && onRequestLabels) {
      onRequestLabels()
    }
  }, [expanded, display.fields.labels, onRequestLabels])

  const toggleField = (field: PRListField, value: boolean) => {
    onChange({ ...display, fields: { ...display.fields, [field]: value } })
  }

  const setLabelFilter = (filter: PRLabelFilter) => {
    onChange({ ...display, labelFilter: filter })
  }

  return (
    <div className="border border-border rounded-md" style={{ padding: '10px 14px' }}>
      <div className="flex items-center justify-between gap-3">
        <button
          className="flex-1 min-w-0 text-left focus:outline-none"
          onClick={() => setExpanded((v) => !v)}
        >
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-text truncate">{title}</span>
            {customized && (
              <span className="text-[10px] uppercase tracking-wide text-accent border border-accent rounded px-1.5 py-0.5">
                Customized
              </span>
            )}
          </div>
          <p className="text-[10px] text-text-muted truncate">{description}</p>
        </button>
        <div className="flex items-center gap-2 shrink-0">
          {onReset && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onReset}
              className="border border-border"
              style={{ padding: '4px 10px' }}
            >
              Reset to default
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded((v) => !v)}
            style={{ padding: '4px 8px' }}
          >
            {expanded ? 'Hide' : 'Edit'}
          </Button>
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: 10 }}>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {PR_LIST_FIELDS.map((f) => (
              <FieldCheckbox
                key={f.key}
                checked={display.fields[f.key]}
                onChange={(v) => toggleField(f.key, v)}
                label={f.label}
                description={f.description}
              />
            ))}
          </div>

          {display.fields.labels && (
            <div
              className="border border-border rounded-md"
              style={{ marginTop: 12, padding: '10px 12px' }}
            >
              <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
                <p className="text-xs font-medium text-text">Labels to show</p>
                <ToggleGroup
                  options={[
                    { value: 'all', label: 'All' },
                    { value: 'only', label: 'Only selected' },
                  ]}
                  value={display.labelFilter.mode}
                  onChange={(v) => {
                    if (v === 'all') {
                      setLabelFilter({ mode: 'all' })
                    } else {
                      const existing = display.labelFilter.mode === 'only'
                        ? display.labelFilter.names
                        : []
                      setLabelFilter({ mode: 'only', names: existing })
                    }
                  }}
                />
              </div>

              {display.labelFilter.mode === 'only' && (
                <LabelPicker
                  selected={display.labelFilter.names}
                  knownLabels={knownLabels}
                  loading={loadingLabels}
                  onChange={(names) => setLabelFilter({ mode: 'only', names })}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface FieldCheckboxProps {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  description: string
}

function FieldCheckbox({ checked, onChange, label, description }: FieldCheckboxProps) {
  return (
    <button
      type="button"
      className="text-left text-xs rounded transition-colors flex items-start gap-2 hover:bg-bg-tertiary"
      style={{ padding: '6px 8px' }}
      onClick={() => onChange(!checked)}
    >
      <span
        className={`shrink-0 w-3.5 h-3.5 rounded-sm border flex items-center justify-center text-[10px] ${
          checked ? 'bg-accent border-accent text-bg' : 'border-border'
        }`}
        style={{ marginTop: 1 }}
      >
        {checked ? '✓' : ''}
      </span>
      <span className="min-w-0">
        <span className="block text-text">{label}</span>
        <span className="block text-[10px] text-text-muted truncate">{description}</span>
      </span>
    </button>
  )
}

interface LabelPickerProps {
  selected: string[]
  knownLabels: PRLabel[]
  loading?: boolean
  onChange: (names: string[]) => void
}

function LabelPicker({ selected, knownLabels, loading, onChange }: LabelPickerProps) {
  const selectedSet = new Set(selected)
  // Render every known label; if any selected names aren't in knownLabels yet
  // (e.g. defaults card with no fetched labels), still surface them as chips.
  const knownByName = new Map(knownLabels.map((l) => [l.name, l] as const))
  const extras = selected
    .filter((n) => !knownByName.has(n))
    .map<PRLabel>((name) => ({ name, color: '888888' }))
  const all: PRLabel[] = [...knownLabels, ...extras].sort((a, b) =>
    a.name.localeCompare(b.name)
  )

  const toggle = (name: string) => {
    if (selectedSet.has(name)) {
      onChange(selected.filter((n) => n !== name))
    } else {
      onChange([...selected, name])
    }
  }

  if (loading && all.length === 0) {
    return <p className="text-[11px] text-text-muted">Loading labels…</p>
  }

  if (all.length === 0) {
    return (
      <p className="text-[11px] text-text-muted">
        No labels found in this repository.
      </p>
    )
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {all.map((l) => {
        const checked = selectedSet.has(l.name)
        return (
          <button
            key={l.name}
            type="button"
            onClick={() => toggle(l.name)}
            className={`focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-full ${
              checked ? '' : 'opacity-50 hover:opacity-100'
            }`}
            title={checked ? 'Click to remove' : 'Click to include'}
          >
            <PRLabelChip label={l} />
          </button>
        )
      })}
    </div>
  )
}
