import { useEffect, useMemo, useState } from 'react'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { useFoundryStore } from '../../stores/foundryStore'
import type {
  FoundryConfig,
  FoundryWorkerPermissionMode,
  Project,
} from '../../../shared/types'

interface Props {
  projects: Project[]
}

const PERMISSION_MODE_OPTIONS: Array<{
  value: FoundryWorkerPermissionMode
  label: string
  hint: string
}> = [
  {
    value: 'bypassPermissions',
    label: 'Bypass (skip permissions)',
    hint: 'Recommended for autopilot — workers run with --dangerously-skip-permissions. Required for unattended runs.',
  },
  {
    value: 'acceptEdits',
    label: 'Accept edits',
    hint: 'Workers auto-accept file edits but pause on Bash/non-edit tools — will stall during autopilot.',
  },
  {
    value: 'default',
    label: 'Default (prompts)',
    hint: 'Workers prompt on every permission — autopilot will stall until a human responds.',
  },
]

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
    branchNameTemplate: 'foundry/{{taskTitleSlug}}',
    maxConcurrentTasks: 2,
    workerPermissionMode: 'bypassPermissions',
    triggerOnCompletedStatusEnter: true,
  }
}

export function FoundrySettings({ projects }: Props) {
  const configs = useFoundryStore((s) => s.configs)
  const reload = useFoundryStore((s) => s.reload)
  const save = useFoundryStore((s) => s.save)
  const remove = useFoundryStore((s) => s.remove)
  const project = projects[0]

  useEffect(() => {
    void reload()
  }, [reload])

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

      {projectFoundries.length === 0 && (
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
                {cfg.paused ? ' · paused' : ''} · max {cfg.maxConcurrentTasks}
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

      {editing && (
        <FoundryEditor
          key={editing.id}
          cfg={editing}
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
  onSave: (cfg: FoundryConfig) => Promise<void>
  onClose: () => void
}

function FoundryEditor({ cfg, onSave, onClose }: EditorProps) {
  const [draft, setDraft] = useState<FoundryConfig>(cfg)
  const update = (patch: Partial<FoundryConfig>): void => setDraft((d) => ({ ...d, ...patch }))

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
          onChange={(e) => update({ maxConcurrentTasks: Math.max(1, Number(e.target.value) || 1) })}
        />

        <fieldset className="border border-border rounded-md" style={{ padding: '10px' }}>
          <legend className="text-[11px] text-text-muted">Completion transition</legend>
          <Input
            label="Property"
            value={draft.completionTransition.property}
            onChange={(e) =>
              update({
                completionTransition: { ...draft.completionTransition, property: e.target.value },
              })
            }
          />
          <Input
            label="From value (optional)"
            value={draft.completionTransition.fromValue ?? ''}
            onChange={(e) =>
              update({
                completionTransition: { ...draft.completionTransition, fromValue: e.target.value },
              })
            }
          />
          <Input
            label="To value"
            value={draft.completionTransition.toValue}
            onChange={(e) =>
              update({
                completionTransition: { ...draft.completionTransition, toValue: e.target.value },
              })
            }
          />
        </fieldset>

        <Input
          label="Completed statuses (comma-separated)"
          hint="Statuses the foreman treats as 'dependency satisfied'."
          value={(draft.completedStatuses ?? []).join(', ')}
          onChange={(e) =>
            update({
              completedStatuses: e.target.value
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
        />

        <div>
          <p className="text-[11px] text-text-muted" style={{ marginBottom: 6 }}>
            Worker permission mode
          </p>
          {PERMISSION_MODE_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className="flex items-start gap-2 text-xs text-text"
              style={{ marginBottom: 6 }}
            >
              <input
                type="radio"
                name="permission-mode"
                checked={draft.workerPermissionMode === opt.value}
                onChange={() => update({ workerPermissionMode: opt.value })}
              />
              <span>
                <span className="font-medium">{opt.label}</span>
                <span className="block text-[11px] text-text-muted">{opt.hint}</span>
              </span>
            </label>
          ))}
        </div>

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
