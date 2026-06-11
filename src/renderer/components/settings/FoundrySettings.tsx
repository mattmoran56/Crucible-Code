import { useEffect, useMemo, useState } from 'react'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { useFoundryStore } from '../../stores/foundryStore'
import { FilterGroupsEditor } from './NotionIntegrationSettings'
import type {
  FoundryConfig,
  NotionDatabaseProperty,
  NotionDatabaseSchema,
  NotionIntegrationConfig,
  NotionPropertyFilter,
  Project,
} from '../../../shared/types'

interface Props {
  projects: Project[]
}

function newConfig(projectId: string): FoundryConfig {
  return {
    id: crypto.randomUUID(),
    name: 'New Foundry',
    projectId,
    enabled: false,
    taskSetFilters: [],
    completionTransition: { property: 'Status', fromValue: 'In review', toValue: 'Testing' },
    completedStatuses: ['Done', 'Testing'],
    pickupUpdates: [],
    readyForReviewUpdates: [],
    implementCommandTemplate: '/notion-ticket {{taskUrl}}',
    readyForReviewCommandTemplate: '',
    branchNameTemplate: 'foundry/{{taskTitleSlug}}',
    maxConcurrentTasks: 2,
    // Workers inherit the user's global claude permission posture (auto
    // mode etc.). We deliberately never force --dangerously-skip-permissions.
    workerPermissionMode: 'default',
    triggerOnCompletedStatusEnter: true,
  }
}

export function FoundrySettings({ projects }: Props) {
  const configs = useFoundryStore((s) => s.configs)
  const reload = useFoundryStore((s) => s.reload)
  const save = useFoundryStore((s) => s.save)
  const remove = useFoundryStore((s) => s.remove)
  const project = projects[0]

  const [notionConfig, setNotionConfig] = useState<NotionIntegrationConfig | null>(null)
  const [notionLoaded, setNotionLoaded] = useState(false)
  const [schema, setSchema] = useState<NotionDatabaseSchema | null>(null)
  const [schemaError, setSchemaError] = useState<string | null>(null)

  useEffect(() => {
    void reload()
  }, [reload])

  // Load the project's Notion config to (a) gate Foundry on it being set
  // and (b) reuse its token+db to fetch the schema for dropdowns.
  useEffect(() => {
    if (!project) {
      setNotionConfig(null)
      setNotionLoaded(true)
      return
    }
    setNotionLoaded(false)
    void window.api.notion
      .loadConfig(project.id)
      .then((cfg) => {
        setNotionConfig(cfg)
        setNotionLoaded(true)
      })
      .catch(() => {
        setNotionConfig(null)
        setNotionLoaded(true)
      })
  }, [project?.id])

  useEffect(() => {
    if (!notionConfig?.apiToken || !notionConfig?.databaseId) {
      setSchema(null)
      return
    }
    let cancelled = false
    setSchemaError(null)
    void window.api.notion
      .getDatabaseSchema(notionConfig.apiToken, notionConfig.databaseId)
      .then((s) => {
        if (!cancelled) setSchema(s)
      })
      .catch((err) => {
        if (!cancelled) setSchemaError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [notionConfig?.apiToken, notionConfig?.databaseId])

  const projectFoundries = useMemo(
    () => configs.filter((c) => !project || c.projectId === project.id),
    [configs, project]
  )

  const [editingId, setEditingId] = useState<string | null>(null)
  const editing = useMemo(
    () => projectFoundries.find((c) => c.id === editingId) ?? null,
    [projectFoundries, editingId]
  )

  if (!project) {
    return <p className="text-xs text-text-muted">Add a project before configuring a Foundry.</p>
  }

  const notionReady =
    !!notionConfig?.apiToken && !!notionConfig?.databaseId

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-text" style={{ marginBottom: 4 }}>
          Foundry
        </h1>
        <p className="text-xs text-text-muted" style={{ marginBottom: 16 }}>
          Run a whole Notion task set on autopilot. A foreman plans dependencies and starts up to{' '}
          <em>max-concurrent</em> sessions; each pipeline implements → draft PR → review loop → ready.
        </p>
      </div>

      {notionLoaded && !notionReady && (
        <div
          className="border border-amber-500/40 bg-amber-500/10 rounded-md text-xs text-text"
          style={{ padding: '10px 14px' }}
        >
          <p className="font-medium" style={{ marginBottom: 4 }}>
            Notion integration required
          </p>
          <p className="text-text-muted">
            Foundry reads its task set from this project's Notion database. Configure{' '}
            <strong>Settings → Notion</strong> for "{project.name}" first — once the API token and
            database are set there, Foundry will pick them up.
          </p>
        </div>
      )}

      {schemaError && (
        <div className="text-[11px] text-rose-300">Could not load Notion schema: {schemaError}</div>
      )}

      {projectFoundries.length === 0 && notionReady && (
        <p className="text-xs text-text-muted">No foundries yet.</p>
      )}

      {projectFoundries.map((cfg) => (
        <div
          key={cfg.id}
          className="border border-border rounded-md"
          style={{ padding: '10px 14px' }}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-text">{cfg.name}</p>
              <p className="text-[11px] text-text-muted">
                {cfg.enabled ? 'enabled' : 'disabled'}
                {cfg.paused ? ' · paused' : ''} · max {cfg.maxConcurrentTasks} · transition{' '}
                {cfg.completionTransition.fromValue ?? '*'} → {cfg.completionTransition.toValue}
              </p>
            </div>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => setEditingId(cfg.id)}>
                Edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void remove(cfg.id)}
                className="text-danger"
              >
                Delete
              </Button>
            </div>
          </div>
        </div>
      ))}

      {notionReady && (
        <Button
          size="sm"
          variant="ghost"
          className="text-accent self-start"
          onClick={() => {
            const cfg = newConfig(project.id)
            void save(cfg).then(() => setEditingId(cfg.id))
          }}
        >
          + Add Foundry
        </Button>
      )}

      {editing && (
        <FoundryEditor
          key={editing.id}
          cfg={editing}
          schema={schema}
          apiToken={notionConfig?.apiToken ?? ''}
          onSave={async (next) => {
            await save(next)
          }}
          onClose={() => setEditingId(null)}
        />
      )}
    </div>
  )
}

interface EditorProps {
  cfg: FoundryConfig
  schema: NotionDatabaseSchema | null
  apiToken: string
  onSave: (cfg: FoundryConfig) => Promise<void>
  onClose: () => void
}

function FoundryEditor({ cfg, schema, apiToken, onSave, onClose }: EditorProps) {
  const [draft, setDraft] = useState<FoundryConfig>(cfg)
  const update = (patch: Partial<FoundryConfig>) =>
    setDraft((d) => ({ ...d, ...patch }))

  // Status-like properties from the schema — the only ones whose value is
  // a finite enumerable list we can render as a dropdown.
  const statusProps: NotionDatabaseProperty[] = useMemo(
    () => (schema?.properties ?? []).filter((p) => p.type === 'status' || p.type === 'select'),
    [schema]
  )
  const selectedProp = useMemo(
    () => statusProps.find((p) => p.name === draft.completionTransition.property) ?? null,
    [statusProps, draft.completionTransition.property]
  )
  const optionNames = selectedProp?.options?.map((o) => o.name) ?? []

  return (
    <div className="border border-accent/50 rounded-md" style={{ padding: '14px' }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
        <h2 className="text-sm font-medium text-text">Editing — {cfg.name}</h2>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        <Input
          label="Name"
          value={draft.name}
          onChange={(e) => update({ name: e.target.value })}
        />

        <label className="flex items-center gap-2 text-xs text-text">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => update({ enabled: e.target.checked })}
          />
          Enabled
        </label>

        <Input
          label="Implement command template"
          hint="Typed into the worker session. Supports {{taskUrl}}, {{taskTitle}}, {{taskId}}, {{taskTitleSlug}}."
          value={draft.implementCommandTemplate}
          onChange={(e) => update({ implementCommandTemplate: e.target.value })}
        />

        <Input
          label="Ready-for-review command (optional)"
          hint="Fresh headless claude on the same worktree after the review loop, before marking the PR ready. Supports {{prUrl}}, {{prNumber}}, {{branch}} on top of the task placeholders. Blank = skip."
          value={draft.readyForReviewCommandTemplate ?? ''}
          onChange={(e) => update({ readyForReviewCommandTemplate: e.target.value })}
        />

        <Input
          label="Branch name template"
          value={draft.branchNameTemplate ?? ''}
          onChange={(e) => update({ branchNameTemplate: e.target.value })}
        />

        <Input
          label="Base branch"
          hint="Pipelines branch off this. Defaults to the repo default if blank."
          value={draft.baseBranch ?? ''}
          onChange={(e) => update({ baseBranch: e.target.value })}
        />

        <Input
          label="Max concurrent tasks"
          type="number"
          value={String(draft.maxConcurrentTasks)}
          onChange={(e) =>
            update({ maxConcurrentTasks: Math.max(1, Number(e.target.value) || 1) })
          }
        />

        <fieldset className="border border-border rounded-md" style={{ padding: '10px' }}>
          <legend className="text-[11px] text-text-muted">Task set</legend>
          <p className="text-[11px] text-text-muted" style={{ marginBottom: 8 }}>
            Which tickets in the project's Notion DB does this foundry care about? Filters here
            scope the watcher and foreman; leave empty to mean "all tickets in this DB."
          </p>
          {schema ? (
            <FilterGroupsEditor
              schema={schema}
              apiToken={apiToken}
              groups={draft.taskSetFilters}
              onChange={(taskSetFilters: NotionPropertyFilter[][]) => update({ taskSetFilters })}
            />
          ) : (
            <p className="text-[11px] text-text-muted italic">Loading Notion schema…</p>
          )}
        </fieldset>

        <fieldset className="border border-border rounded-md" style={{ padding: '10px' }}>
          <legend className="text-[11px] text-text-muted">Eligibility (optional)</legend>
          <p className="text-[11px] text-text-muted" style={{ marginBottom: 8 }}>
            Of the task-set, which are ready to actually start? Foreman only picks from this
            subset. Common: Status = Not started, Assignee = me. Leave empty to let the foreman
            decide from the full task set.
          </p>
          {schema ? (
            <FilterGroupsEditor
              schema={schema}
              apiToken={apiToken}
              groups={draft.eligibilityFilters ? [draft.eligibilityFilters] : []}
              onChange={(groups: NotionPropertyFilter[][]) =>
                update({ eligibilityFilters: groups[0] ?? [] })
              }
            />
          ) : (
            <p className="text-[11px] text-text-muted italic">Loading Notion schema…</p>
          )}
        </fieldset>

        <fieldset className="border border-border rounded-md" style={{ padding: '10px' }}>
          <legend className="text-[11px] text-text-muted">Completion transition</legend>
          <p className="text-[11px] text-text-muted" style={{ marginBottom: 8 }}>
            When a ticket moves from <em>from</em> to <em>to</em> (by anyone — human, Notion
            automation, an external sync, etc.), the foundry treats it as verified complete and
            picks the next unblocked task. Detection is snapshot-diff against the 20s poll, so
            actor doesn't matter.
          </p>

          <SelectField
            label="Property"
            value={draft.completionTransition.property}
            options={statusProps.map((p) => p.name)}
            onChange={(value) =>
              update({
                completionTransition: {
                  ...draft.completionTransition,
                  property: value,
                  // Reset values when the property changes — old enum values
                  // won't match the new property's options.
                  fromValue: '',
                  toValue: '',
                },
              })
            }
            emptyHint={schema ? 'No status/select properties in this DB.' : 'Loading Notion schema…'}
          />

          <SelectField
            label="From value"
            value={draft.completionTransition.fromValue ?? ''}
            options={optionNames}
            onChange={(value) =>
              update({
                completionTransition: { ...draft.completionTransition, fromValue: value },
              })
            }
            emptyHint="Pick a property first."
          />

          <SelectField
            label="To value"
            value={draft.completionTransition.toValue}
            options={optionNames}
            onChange={(value) =>
              update({
                completionTransition: { ...draft.completionTransition, toValue: value },
              })
            }
            emptyHint="Pick a property first."
          />
        </fieldset>

        <MultiSelectField
          label="Completed statuses"
          hint="Statuses the foreman treats as 'dependency satisfied' when reasoning about order."
          value={draft.completedStatuses ?? []}
          options={optionNames}
          onChange={(values) => update({ completedStatuses: values })}
          emptyHint="Pick a transition property first."
        />

        <div className="flex gap-2 mt-2">
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              void onSave(draft).then(onClose)
            }}
          >
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  )
}

interface SelectFieldProps {
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
  emptyHint?: string
}

function SelectField({ label, value, options, onChange, emptyHint }: SelectFieldProps) {
  return (
    <div style={{ marginBottom: 8 }}>
      <label className="block text-[11px] font-medium text-text-muted" style={{ marginBottom: 4 }}>
        {label}
      </label>
      {options.length === 0 ? (
        <p className="text-[11px] text-text-muted italic">{emptyHint ?? 'No options available.'}</p>
      ) : (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="bg-bg border border-border rounded-md text-xs text-text focus:outline-none focus:border-accent w-full"
          style={{ padding: '6px 10px' }}
        >
          <option value="">(none)</option>
          {options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}

interface MultiSelectFieldProps {
  label: string
  hint?: string
  value: string[]
  options: string[]
  onChange: (values: string[]) => void
  emptyHint?: string
}

function MultiSelectField({ label, hint, value, options, onChange, emptyHint }: MultiSelectFieldProps) {
  const valueSet = new Set(value)
  const toggle = (opt: string) => {
    if (valueSet.has(opt)) onChange(value.filter((v) => v !== opt))
    else onChange([...value, opt])
  }
  return (
    <div>
      <label className="block text-[11px] font-medium text-text-muted" style={{ marginBottom: 4 }}>
        {label}
      </label>
      {hint && (
        <p className="text-[11px] text-text-muted" style={{ marginBottom: 6 }}>
          {hint}
        </p>
      )}
      {options.length === 0 ? (
        <p className="text-[11px] text-text-muted italic">{emptyHint ?? 'No options available.'}</p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {options.map((opt) => {
            const active = valueSet.has(opt)
            return (
              <button
                key={opt}
                type="button"
                onClick={() => toggle(opt)}
                className={`text-[11px] rounded-md border ${
                  active
                    ? 'border-accent text-accent bg-accent/10'
                    : 'border-border text-text-muted hover:text-text'
                }`}
                style={{ padding: '2px 8px' }}
              >
                {opt}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
