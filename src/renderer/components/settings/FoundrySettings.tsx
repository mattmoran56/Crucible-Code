import { useEffect, useMemo, useState } from 'react'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { ToggleGroup } from '../ui/ToggleGroup'
import { useFoundryStore } from '../../stores/foundryStore'
import { FilterGroupsEditor, UpdatesEditor } from './NotionIntegrationSettings'
import type {
  FoundryConfig,
  NotionDatabaseProperty,
  NotionDatabaseSchema,
  NotionIntegrationConfig,
  NotionPropertyFilter,
  NotionPropertyUpdate,
  Project,
} from '../../../shared/types'

interface Props {
  projects: Project[]
}

const DEFAULT_IMPLEMENT_COMMAND_TEMPLATE = `/notion-ticket {{taskUrl}}

When the ticket is fully implemented:
1. Stage and commit all your changes with a clear message.
2. Push the branch to origin.
3. Open a DRAFT pull request against the base branch. The PR title should summarise the ticket; the PR body should include the Notion ticket URL and a short summary of what you changed.
4. Do not mark the PR ready for review yet, and do not update the Notion ticket status — the Foundry handles both once a separate review loop has converged.

If you are blocked or need a decision, say so clearly and stop without pushing.`

const DEFAULT_READY_FOR_REVIEW_COMMAND_TEMPLATE = `Update the PR review checklist. Use ✓, ✗, and ⊘ — use ⊘ where the question is not applicable or we haven't touched that area. Add a short note only if absolutely necessary; otherwise leave blank. Note that we have reviewed with Claude Code, then mark the PR as ready for review.`

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
    implementCommandTemplate: DEFAULT_IMPLEMENT_COMMAND_TEMPLATE,
    readyForReviewCommandTemplate: DEFAULT_READY_FOR_REVIEW_COMMAND_TEMPLATE,
    branchNameTemplate: 'foundry/{{taskTitleSlug}}',
    maxConcurrentTasks: 2,
    // Workers inherit the user's global claude permission posture (auto
    // mode etc.). We deliberately never force --dangerously-skip-permissions.
    workerPermissionMode: 'default',
    triggerOnCompletedStatusEnter: true,
    optimisticContinue: false,
  }
}

export function FoundrySettings({ projects }: Props) {
  const configs = useFoundryStore((s) => s.configs)
  const reload = useFoundryStore((s) => s.reload)
  const save = useFoundryStore((s) => s.save)
  const remove = useFoundryStore((s) => s.remove)
  const resetState = useFoundryStore((s) => s.resetState)
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
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium text-text truncate">{cfg.name}</p>
              <p className="text-[11px] text-text-muted truncate">
                {cfg.paused ? 'paused · ' : ''}max {cfg.maxConcurrentTasks} · transition{' '}
                {cfg.completionTransition.fromValue ?? '*'} → {cfg.completionTransition.toValue}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button size="sm" variant="ghost" onClick={() => setEditingId(cfg.id)}>
                Edit
              </Button>
              {!cfg.enabled && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    if (
                      window.confirm(
                        `Reset all runtime state for "${cfg.name}"? Pipelines, pass history, snapshot, and the foreman conversation will all be wiped. The config itself is kept. Existing worktrees + sessions are NOT touched.`
                      )
                    ) {
                      void resetState(cfg.id).then((r) => {
                        if (!r.ok && r.reason) window.alert(`Reset refused: ${r.reason}`)
                      })
                    }
                  }}
                >
                  Reset
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void remove(cfg.id)}
                className="text-danger"
              >
                Delete
              </Button>
              <ToggleGroup
                options={[
                  { value: 'off', label: 'Off' },
                  { value: 'on', label: 'On' },
                ]}
                value={cfg.enabled ? 'on' : 'off'}
                onChange={(v) => void save({ ...cfg, enabled: v === 'on' })}
              />
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

  // Existing stacks in the project, offered when "Add to existing stack".
  const [projectStacks, setProjectStacks] = useState<Array<{ id: string; name: string }>>([])
  useEffect(() => {
    let alive = true
    window.api.prStack.list(draft.projectId).then((list) => {
      if (alive) setProjectStacks(list.map((s) => ({ id: s.id, name: s.name })))
    })
    return () => { alive = false }
  }, [draft.projectId])

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

        <PromptTextarea
          label="Implement prompt"
          hint="Sent verbatim to the worker session as its first message. Supports {{taskUrl}}, {{taskTitle}}, {{taskId}}, {{taskTitleSlug}}. The worker is responsible for committing, pushing, and opening a draft PR — the prompt should say so."
          value={draft.implementCommandTemplate}
          fallback={DEFAULT_IMPLEMENT_COMMAND_TEMPLATE}
          onChange={(v) => update({ implementCommandTemplate: v })}
        />

        <PromptTextarea
          label="Ready-for-review prompt (optional)"
          hint="Run as a fresh claude on the worktree after the review loop converges. Supports {{prUrl}}, {{prNumber}}, {{branch}} on top of the task placeholders. Empty = skip this step."
          value={draft.readyForReviewCommandTemplate ?? ''}
          fallback={DEFAULT_READY_FOR_REVIEW_COMMAND_TEMPLATE}
          onChange={(v) => update({ readyForReviewCommandTemplate: v })}
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

        <fieldset className="border border-border rounded-md" style={{ padding: '10px' }}>
          <legend className="text-[11px] text-text-muted">On pickup</legend>
          <p className="text-[11px] text-text-muted" style={{ marginBottom: 8 }}>
            Property updates applied to the Notion page the moment a worker
            session is created (e.g. <em>Status: Not Started → In Progress</em>).
            Supports placeholders: <code>{'{{branch}}'}</code>, <code>{'{{sessionId}}'}</code>,
            etc.; updates that reference those run after the session is created,
            the rest run immediately.
          </p>
          {schema ? (
            <UpdatesEditor
              schema={schema}
              updates={draft.pickupUpdates}
              onChange={(pickupUpdates: NotionPropertyUpdate[]) => update({ pickupUpdates })}
            />
          ) : (
            <p className="text-[11px] text-text-muted italic">Loading Notion schema…</p>
          )}
        </fieldset>

        <fieldset className="border border-border rounded-md" style={{ padding: '10px' }}>
          <legend className="text-[11px] text-text-muted">On ready for review</legend>
          <p className="text-[11px] text-text-muted" style={{ marginBottom: 8 }}>
            Updates applied right after the review loop converges and the PR
            is marked ready (e.g. <em>Status → In review</em>). Has access to
            <code>{' {{prUrl}}'}</code> and <code>{'{{prNumber}}'}</code> in
            addition to the usual placeholders.
          </p>
          {schema ? (
            <UpdatesEditor
              schema={schema}
              updates={draft.readyForReviewUpdates}
              onChange={(readyForReviewUpdates: NotionPropertyUpdate[]) =>
                update({ readyForReviewUpdates })
              }
            />
          ) : (
            <p className="text-[11px] text-text-muted italic">Loading Notion schema…</p>
          )}
        </fieldset>

        <MultiSelectField
          label="Completed statuses"
          hint="Statuses the foreman treats as 'dependency satisfied' (merged to trunk) when reasoning about order."
          value={draft.completedStatuses ?? []}
          options={optionNames}
          onChange={(values) => update({ completedStatuses: values })}
          emptyHint="Pick a transition property first."
        />

        <fieldset className="border border-border rounded-md" style={{ padding: '10px' }}>
          <legend className="text-[11px] text-text-muted">Optimistic continue</legend>
          <p className="text-[11px] text-text-muted" style={{ marginBottom: 8 }}>
            When on, dependencies sitting in an <em>optimistic</em> status (open PR, not yet merged
            to trunk — e.g. <em>In review</em>) count as satisfied: the foreman picks up the next
            ticket they unblock, and the worker merges those open PR branches into its own branch
            before implementing. Off = wait for dependencies to reach a completed (on-trunk) status.
            Safe to toggle while running — it takes effect on the next pass.
          </p>
          <div
            className="flex items-center gap-2"
            style={{ marginBottom: draft.optimisticContinue ? 10 : 0 }}
          >
            <span className="text-[11px] text-text-muted">Optimistic continue</span>
            <ToggleGroup
              options={[
                { value: 'off', label: 'Off' },
                { value: 'on', label: 'On' },
              ]}
              value={draft.optimisticContinue ? 'on' : 'off'}
              onChange={(v) => update({ optimisticContinue: v === 'on' })}
            />
          </div>
          {draft.optimisticContinue && (
            <MultiSelectField
              label="Optimistic statuses"
              hint="Statuses meaning 'PR open but not yet on trunk'. A dependency in one of these is treated as satisfied and its PR branch is merged into the dependent ticket. Defaults to In review."
              value={draft.optimisticStatuses ?? ['In review']}
              options={optionNames}
              onChange={(values) => update({ optimisticStatuses: values })}
              emptyHint="Pick a transition property first."
            />
          )}
        </fieldset>

        <fieldset className="border border-border rounded-md" style={{ padding: '10px' }}>
          <legend className="text-[11px] text-text-muted">Local PRs</legend>
          <p className="text-[11px] text-text-muted" style={{ marginBottom: 8 }}>
            When on, workers produce <em>local PRs</em> instead of opening real GitHub PRs — the run
            builds a chained stack on an integration branch that you publish later with the
            <strong> Create PRs</strong> button. Off = workers open real draft PRs as usual.
          </p>
          <div
            className="flex items-center gap-2"
            style={{ marginBottom: draft.localPrMode ? 10 : 0 }}
          >
            <span className="text-[11px] text-text-muted">Local PR mode</span>
            <ToggleGroup
              options={[
                { value: 'off', label: 'Off' },
                { value: 'on', label: 'On' },
              ]}
              value={draft.localPrMode ? 'on' : 'off'}
              onChange={(v) => update({ localPrMode: v === 'on' })}
            />
          </div>
          {draft.localPrMode && (
            <Input
              label="Foundry integration branch"
              hint="Every worker branches off this branch and runs in parallel; the stack is assembled in completion order. Defaults to foundry/integration-<id>."
              value={draft.foundryBranch ?? ''}
              onChange={(e) => update({ foundryBranch: e.target.value })}
            />
          )}
          {draft.localPrMode && (
            <div style={{ marginTop: 10 }}>
              <label className="block text-[11px] font-medium text-text-muted" style={{ marginBottom: 4 }}>
                Stacking
              </label>
              <p className="text-[11px] text-text-muted" style={{ marginBottom: 6 }}>
                How completed local PRs are grouped into a managed PR stack. Tickets run in
                parallel and join the stack in completion order; conflicts between them are
                resolved by Claude with the prompt below.
              </p>
              <ToggleGroup
                options={[
                  { value: 'new', label: 'New stack' },
                  { value: 'existing', label: 'Add to existing' },
                  { value: 'none', label: "Don't stack" },
                ]}
                value={draft.stackMode ?? 'new'}
                onChange={(v) => update({ stackMode: v as 'new' | 'existing' | 'none' })}
              />
            </div>
          )}
          {draft.localPrMode && (draft.stackMode ?? 'new') === 'existing' && (
            <div style={{ marginTop: 8 }}>
              <label className="block text-[11px] font-medium text-text-muted" style={{ marginBottom: 4 }}>
                Target stack
              </label>
              {projectStacks.length === 0 ? (
                <p className="text-[11px] text-text-muted italic">
                  No stacks in this project yet — create one in the PR Stacks panel first.
                </p>
              ) : (
                <select
                  value={draft.stackTargetStackId ?? ''}
                  onChange={(e) => update({ stackTargetStackId: e.target.value || undefined })}
                  className="bg-bg border border-border rounded-md text-xs text-text focus:outline-none focus:border-accent w-full"
                  style={{ padding: '6px 10px' }}
                >
                  <option value="">(choose a stack)</option>
                  {projectStacks.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              )}
            </div>
          )}
          {draft.localPrMode && (draft.stackMode ?? 'new') !== 'none' && (
            <div style={{ marginTop: 8 }}>
              <PromptTextarea
                label="Conflict-resolution prompt (optional)"
                hint="Injected when Claude resolves a merge conflict while publishing/propagating this stack. Supports {{entryBranch}}, {{belowBranch}}, {{files}}. Empty = built-in default."
                value={draft.stackConflictPrompt ?? ''}
                fallback=""
                onChange={(v) => update({ stackConflictPrompt: v })}
              />
            </div>
          )}
        </fieldset>

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

interface PromptTextareaProps {
  label: string
  hint?: string
  value: string
  fallback: string
  onChange: (value: string) => void
}

/**
 * Multi-line textarea for foundry prompt templates. Shows the full text
 * verbatim — there is no hidden suffix appended elsewhere. A "Reset to
 * default" link lets the user snap back to the canonical prompt without
 * having to look it up.
 */
function PromptTextarea({ label, hint, value, fallback, onChange }: PromptTextareaProps) {
  const isDefault = value === fallback
  return (
    <div>
      <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
        <label className="text-[11px] font-medium text-text-muted">{label}</label>
        {!isDefault && fallback && (
          <button
            type="button"
            className="text-[10px] text-accent hover:underline"
            onClick={() => onChange(fallback)}
          >
            Reset to default
          </button>
        )}
      </div>
      {hint && (
        <p className="text-[11px] text-text-muted" style={{ marginBottom: 6 }}>
          {hint}
        </p>
      )}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={8}
        className="w-full bg-bg border border-border rounded-md text-xs text-text font-mono focus:outline-none focus:border-accent"
        style={{ padding: '8px 10px', resize: 'vertical', minHeight: 120 }}
      />
    </div>
  )
}
