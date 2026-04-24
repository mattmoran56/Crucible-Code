import React, { useEffect, useState } from 'react'
import type {
  CustomButton,
  CustomButtonGroup,
  ButtonPlacement,
  ButtonActionType,
  ButtonExecutionMode,
  ButtonScope,
} from '../../../shared/types'
import { useButtonStore } from '../../stores/buttonStore'
import { useProjectStore } from '../../stores/projectStore'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import { Dialog } from '../ui/Dialog'
import { Input } from '../ui/Input'
import { ToggleGroup } from '../ui/ToggleGroup'
import { IconPicker, renderButtonIcon } from '../buttons/IconPicker'
import { getAppAction, getAppActionGroups } from '../../stores/appActions'

const PLACEMENT_OPTIONS: { value: ButtonPlacement; label: string }[] = [
  { value: 'session-toolbar', label: 'Session' },
  { value: 'project-tabs', label: 'Top Bar' },
  { value: 'right-activity-bar', label: 'Right Bar' },
]

const ACTION_OPTIONS: { value: ButtonActionType; label: string }[] = [
  { value: 'shell', label: 'Shell' },
  { value: 'claude', label: 'Claude' },
  { value: 'app-action', label: 'App Action' },
]

const EXEC_OPTIONS: { value: ButtonExecutionMode; label: string }[] = [
  { value: 'background', label: 'Background' },
  { value: 'terminal', label: 'Terminal' },
]

const SCOPE_TYPE_OPTIONS = [
  { value: 'global', label: 'Global' },
  { value: 'all-projects', label: 'All Projects' },
  { value: 'projects', label: 'Specific' },
] as const

interface ButtonFormState {
  label: string
  icon: string
  placement: ButtonPlacement
  actionType: ButtonActionType
  executionMode: ButtonExecutionMode
  command: string
  cwd: string
  scopeType: 'global' | 'all-projects' | 'projects'
  projectIds: string[]
  groupId: string
  confirmMessage: string
  shortcut: string
}

const defaultForm: ButtonFormState = {
  label: '',
  icon: 'Play',
  placement: 'session-toolbar',
  actionType: 'shell',
  executionMode: 'background',
  command: '',
  cwd: '',
  scopeType: 'global',
  projectIds: [],
  groupId: '',
  confirmMessage: '',
  shortcut: '',
}

function formToButton(form: ButtonFormState, existingId?: string, order = 0): CustomButton {
  const scope: ButtonScope =
    form.scopeType === 'global'
      ? { type: 'global' }
      : form.scopeType === 'all-projects'
        ? { type: 'all-projects' }
        : { type: 'projects', projectIds: form.projectIds }

  return {
    id: existingId ?? crypto.randomUUID(),
    label: form.label,
    icon: form.icon || undefined,
    placement: form.placement,
    actionType: form.actionType,
    executionMode: form.executionMode,
    command: form.command,
    cwd: form.cwd || undefined,
    scope,
    order,
    groupId: form.groupId || undefined,
    confirmMessage: form.confirmMessage || undefined,
    shortcut: form.shortcut || undefined,
  }
}

function buttonToForm(button: CustomButton): ButtonFormState {
  return {
    label: button.label,
    icon: button.icon ?? 'Play',
    placement: button.placement,
    actionType: button.actionType,
    executionMode: button.executionMode,
    command: button.command,
    cwd: button.cwd ?? '',
    scopeType: button.scope.type === 'projects' ? 'projects' : button.scope.type === 'all-projects' ? 'all-projects' : 'global',
    projectIds: button.scope.type === 'projects' ? button.scope.projectIds : [],
    groupId: button.groupId ?? '',
    confirmMessage: button.confirmMessage ?? '',
    shortcut: button.shortcut ?? '',
  }
}

export function ButtonSettings() {
  const {
    buttons, groups,
    loadButtons, loadGroups,
    addButton, updateButton, removeButton,
    addGroup, removeGroup,
    reorderButtons,
  } = useButtonStore()
  const { projects } = useProjectStore()

  const [showEditor, setShowEditor] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<ButtonFormState>(defaultForm)
  const [showGroupDialog, setShowGroupDialog] = useState(false)
  const [groupForm, setGroupForm] = useState({ label: '', icon: 'Settings', placement: 'session-toolbar' as ButtonPlacement })
  const [showIconPicker, setShowIconPicker] = useState(false)

  useEffect(() => {
    loadButtons()
    loadGroups()
  }, [])

  const handleEdit = (button: CustomButton) => {
    setForm(buttonToForm(button))
    setEditingId(button.id)
    setShowEditor(true)
  }

  const handleCreate = () => {
    setForm(defaultForm)
    setEditingId(null)
    setShowEditor(true)
  }

  const handleSave = async () => {
    if (!form.label || !form.command) return
    if (editingId) {
      const existing = buttons.find((b) => b.id === editingId)
      await updateButton(formToButton(form, editingId, existing?.order ?? 0))
    } else {
      const maxOrder = buttons.filter((b) => b.placement === form.placement)
        .reduce((max, b) => Math.max(max, b.order), -1)
      await addButton(formToButton(form, undefined, maxOrder + 1))
    }
    setShowEditor(false)
    setEditingId(null)
  }

  const handleDelete = async (buttonId: string) => {
    await removeButton(buttonId)
  }

  const handleMoveUp = async (button: CustomButton) => {
    const placement = button.placement
    const sorted = buttons
      .filter((b) => b.placement === placement)
      .sort((a, b) => a.order - b.order)
    const idx = sorted.findIndex((b) => b.id === button.id)
    if (idx <= 0) return
    const ids = sorted.map((b) => b.id)
    ;[ids[idx - 1], ids[idx]] = [ids[idx], ids[idx - 1]]
    await reorderButtons(placement, ids)
  }

  const handleMoveDown = async (button: CustomButton) => {
    const placement = button.placement
    const sorted = buttons
      .filter((b) => b.placement === placement)
      .sort((a, b) => a.order - b.order)
    const idx = sorted.findIndex((b) => b.id === button.id)
    if (idx >= sorted.length - 1) return
    const ids = sorted.map((b) => b.id)
    ;[ids[idx], ids[idx + 1]] = [ids[idx + 1], ids[idx]]
    await reorderButtons(placement, ids)
  }

  const handleCreateGroup = async () => {
    if (!groupForm.label) return
    const group: CustomButtonGroup = {
      id: crypto.randomUUID(),
      label: groupForm.label,
      icon: groupForm.icon || undefined,
      placement: groupForm.placement,
      scope: { type: 'global' },
      order: groups.filter((g) => g.placement === groupForm.placement).length,
    }
    await addGroup(group)
    setShowGroupDialog(false)
    setGroupForm({ label: '', icon: 'Settings', placement: 'session-toolbar' })
  }

  const placementLabel = (p: ButtonPlacement) =>
    PLACEMENT_OPTIONS.find((o) => o.value === p)?.label ?? p

  const scopeLabel = (scope: ButtonScope) => {
    if (scope.type === 'global') return 'Global'
    if (scope.type === 'all-projects') return 'All Projects'
    const names = scope.projectIds
      .map((id) => projects.find((p) => p.id === id)?.name ?? id)
      .join(', ')
    return names || 'Specific'
  }

  // Group buttons by placement for display
  const placements: ButtonPlacement[] = ['session-toolbar', 'project-tabs', 'right-activity-bar']

  const updateFormField = <K extends keyof ButtonFormState>(key: K, value: ButtonFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <div style={{ marginTop: 32 }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
        <div>
          <h1 className="text-lg font-semibold text-text" style={{ marginBottom: 4 }}>Custom Buttons</h1>
          <p className="text-xs text-text-muted">
            Add buttons that run scripts or Claude prompts. Place them in the session toolbar, top bar, or right sidebar.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => setShowGroupDialog(true)}>
            Add Group
          </Button>
          <Button variant="primary" size="sm" onClick={handleCreate}>
            Add Button
          </Button>
        </div>
      </div>

      {buttons.length === 0 && groups.length === 0 ? (
        <div
          className="border border-border rounded-md text-center text-xs text-text-muted"
          style={{ padding: '24px 16px' }}
        >
          No custom buttons yet. Click "Add Button" to create one.
        </div>
      ) : (
        placements.map((placement) => {
          const placementButtons = buttons
            .filter((b) => b.placement === placement)
            .sort((a, b) => a.order - b.order)
          const placementGroups = groups.filter((g) => g.placement === placement)

          if (placementButtons.length === 0 && placementGroups.length === 0) return null

          return (
            <div key={placement} style={{ marginBottom: 20 }}>
              <h3 className="text-xs font-medium text-text-muted uppercase" style={{ marginBottom: 8 }}>
                {placementLabel(placement)}
              </h3>

              {/* Groups */}
              {placementGroups.map((group) => (
                <div
                  key={group.id}
                  className="border border-border rounded-md"
                  style={{ marginBottom: 8, padding: '8px 12px' }}
                >
                  <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
                    <div className="flex items-center gap-2">
                      {renderButtonIcon(group.icon, 14)}
                      <span className="text-xs font-medium text-text">{group.label}</span>
                      <span className="text-[10px] text-text-muted">group</span>
                    </div>
                    <IconButton label="Remove group" size="sm" variant="danger" onClick={() => removeGroup(group.id)}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </IconButton>
                  </div>
                  {placementButtons
                    .filter((b) => b.groupId === group.id)
                    .map((button) => (
                      <ButtonRow
                        key={button.id}
                        button={button}
                        scopeLabel={scopeLabel(button.scope)}
                        onEdit={() => handleEdit(button)}
                        onDelete={() => handleDelete(button.id)}
                        onMoveUp={() => handleMoveUp(button)}
                        onMoveDown={() => handleMoveDown(button)}
                        indent
                      />
                    ))}
                </div>
              ))}

              {/* Ungrouped buttons */}
              {placementButtons
                .filter((b) => !b.groupId)
                .map((button) => (
                  <ButtonRow
                    key={button.id}
                    button={button}
                    scopeLabel={scopeLabel(button.scope)}
                    onEdit={() => handleEdit(button)}
                    onDelete={() => handleDelete(button.id)}
                    onMoveUp={() => handleMoveUp(button)}
                    onMoveDown={() => handleMoveDown(button)}
                  />
                ))}
            </div>
          )
        })
      )}

      {/* Button Editor Dialog */}
      <Dialog
        open={showEditor}
        title={editingId ? 'Edit Button' : 'Add Button'}
        onClose={() => setShowEditor(false)}
        width="32rem"
      >
        <div className="flex flex-col gap-3">
          <div className="flex gap-3">
            <div className="flex-1">
              <Input
                label="Label"
                value={form.label}
                onChange={(e) => updateFormField('label', e.target.value)}
                placeholder="Run Tests"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1.5">Icon</label>
              <button
                type="button"
                onClick={() => setShowIconPicker(!showIconPicker)}
                className="w-9 h-9 rounded border border-border flex items-center justify-center text-text-muted hover:text-text hover:bg-bg-tertiary"
              >
                {renderButtonIcon(form.icon, 16)}
              </button>
            </div>
          </div>

          {showIconPicker && (
            <IconPicker
              value={form.icon}
              onChange={(icon) => {
                updateFormField('icon', icon)
                setShowIconPicker(false)
              }}
            />
          )}

          <div>
            <label className="block text-xs text-text-muted mb-1.5">Placement</label>
            <ToggleGroup
              options={form.actionType === 'app-action' && form.command
                ? PLACEMENT_OPTIONS.filter((o) => {
                    const def = getAppAction(form.command)
                    return def ? def.validPlacements.includes(o.value) : true
                  })
                : PLACEMENT_OPTIONS
              }
              value={form.placement}
              onChange={(v) => updateFormField('placement', v)}
            />
          </div>

          <div className="flex gap-3">
            <div>
              <label className="block text-xs text-text-muted mb-1.5">Action</label>
              <ToggleGroup
                options={ACTION_OPTIONS}
                value={form.actionType}
                onChange={(v) => {
                  updateFormField('actionType', v)
                  updateFormField('command', '')
                }}
              />
            </div>
            {form.actionType !== 'app-action' && (
              <div>
                <label className="block text-xs text-text-muted mb-1.5">Execution</label>
                <ToggleGroup
                  options={EXEC_OPTIONS}
                  value={form.executionMode}
                  onChange={(v) => updateFormField('executionMode', v)}
                />
              </div>
            )}
          </div>

          {form.actionType === 'app-action' ? (
            <div>
              <label className="block text-xs text-text-muted mb-1.5">App Action</label>
              <select
                value={form.command}
                onChange={(e) => {
                  updateFormField('command', e.target.value)
                  const def = getAppAction(e.target.value)
                  if (def) {
                    if (!def.validPlacements.includes(form.placement)) {
                      updateFormField('placement', def.validPlacements[0])
                    }
                    if (def.defaultConfirmMessage && !form.confirmMessage) {
                      updateFormField('confirmMessage', def.defaultConfirmMessage)
                    }
                  }
                }}
                className="w-full bg-bg border border-border rounded-md text-xs text-text focus:outline-none focus:border-accent"
                style={{ padding: '8px 14px' }}
              >
                <option value="">Select an action...</option>
                {getAppActionGroups().map(({ group, actions }) => (
                  <optgroup key={group} label={group}>
                    {actions.map((a) => (
                      <option key={a.id} value={a.id}>{a.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs text-text-muted mb-1.5">
                  {form.actionType === 'claude' ? 'Claude Prompt' : 'Command'}
                </label>
                <textarea
                  value={form.command}
                  onChange={(e) => updateFormField('command', e.target.value)}
                  placeholder={
                    form.actionType === 'claude'
                      ? 'Run the test suite and fix any failures'
                      : 'npm test'
                  }
                  rows={3}
                  className="w-full bg-bg border border-border rounded-md text-xs text-text font-mono focus:outline-none focus:border-accent"
                  style={{ padding: '8px 14px', resize: 'vertical' }}
                />
                <p className="text-[10px] text-text-muted" style={{ marginTop: 2 }}>
                  Variables: {'{{branch}}'}, {'{{worktreePath}}'}, {'{{sessionName}}'}, {'{{repoPath}}'}, {'{{projectName}}'}
                </p>
              </div>

              <Input
                label="Working Directory (optional)"
                value={form.cwd}
                onChange={(e) => updateFormField('cwd', e.target.value)}
                placeholder="{{worktreePath}}"
                hint="Defaults to session worktree path"
              />
            </>
          )}

          <div>
            <label className="block text-xs text-text-muted mb-1.5">Scope</label>
            <ToggleGroup
              options={SCOPE_TYPE_OPTIONS as any}
              value={form.scopeType}
              onChange={(v) => updateFormField('scopeType', v as ButtonFormState['scopeType'])}
            />
          </div>

          {form.scopeType === 'projects' && (
            <div>
              <label className="block text-xs text-text-muted mb-1.5">Projects</label>
              <div className="flex flex-col gap-1">
                {projects.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-xs text-text cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.projectIds.includes(p.id)}
                      onChange={(e) => {
                        const ids = e.target.checked
                          ? [...form.projectIds, p.id]
                          : form.projectIds.filter((id) => id !== p.id)
                        updateFormField('projectIds', ids)
                      }}
                      className="rounded border-border"
                    />
                    {p.name}
                  </label>
                ))}
              </div>
            </div>
          )}

          {groups.length > 0 && (
            <div>
              <label className="block text-xs text-text-muted mb-1.5">Group (optional)</label>
              <select
                value={form.groupId}
                onChange={(e) => updateFormField('groupId', e.target.value)}
                className="w-full bg-bg border border-border rounded-md text-xs text-text focus:outline-none focus:border-accent"
                style={{ padding: '8px 14px' }}
              >
                <option value="">None</option>
                {groups
                  .filter((g) => g.placement === form.placement)
                  .map((g) => (
                    <option key={g.id} value={g.id}>{g.label}</option>
                  ))}
              </select>
            </div>
          )}

          <Input
            label="Keyboard Shortcut (optional)"
            value={form.shortcut}
            onChange={(e) => updateFormField('shortcut', e.target.value)}
            placeholder="Cmd+Shift+T"
            hint="Electron accelerator format"
          />

          <Input
            label="Confirmation Message (optional)"
            value={form.confirmMessage}
            onChange={(e) => updateFormField('confirmMessage', e.target.value)}
            placeholder="Are you sure you want to deploy?"
            hint="If set, a dialog will appear before running"
          />

          <div className="flex justify-end gap-2" style={{ marginTop: 8 }}>
            <Button variant="ghost" onClick={() => setShowEditor(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={!form.label || !form.command}
            >
              {editingId ? 'Save' : 'Create'}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Group Dialog */}
      <Dialog
        open={showGroupDialog}
        title="Add Button Group"
        onClose={() => setShowGroupDialog(false)}
      >
        <div className="flex flex-col gap-3">
          <Input
            label="Group Label"
            value={groupForm.label}
            onChange={(e) => setGroupForm((f) => ({ ...f, label: e.target.value }))}
            placeholder="Deploy Actions"
          />
          <div>
            <label className="block text-xs text-text-muted mb-1.5">Placement</label>
            <ToggleGroup
              options={PLACEMENT_OPTIONS}
              value={groupForm.placement}
              onChange={(v) => setGroupForm((f) => ({ ...f, placement: v }))}
            />
          </div>
          <div className="flex justify-end gap-2" style={{ marginTop: 8 }}>
            <Button variant="ghost" onClick={() => setShowGroupDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleCreateGroup}
              disabled={!groupForm.label}
            >
              Create
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}

// Individual button row in the settings list
function ButtonRow({
  button,
  scopeLabel,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
  indent,
}: {
  button: CustomButton
  scopeLabel: string
  onEdit: () => void
  onDelete: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  indent?: boolean
}) {
  return (
    <div
      className="flex items-center justify-between group hover:bg-bg-tertiary rounded"
      style={{ padding: '6px 10px', marginLeft: indent ? 16 : 0 }}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-text-muted flex-shrink-0">
          {renderButtonIcon(button.icon, 14)}
        </span>
        <span className="text-xs text-text truncate">{button.label}</span>
        <span className="text-[10px] text-text-muted px-1.5 py-0.5 rounded bg-bg-secondary border border-border">
          {scopeLabel}
        </span>
        {button.shortcut && (
          <span className="text-[10px] text-text-muted px-1.5 py-0.5 rounded bg-bg-secondary border border-border font-mono">
            {button.shortcut}
          </span>
        )}
        <span className="text-[10px] text-text-muted">
          {button.actionType === 'claude' ? 'Claude' : button.actionType === 'app-action' ? 'Action' : 'Shell'}
        </span>
      </div>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <IconButton label="Move up" size="sm" onClick={onMoveUp}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="18 15 12 9 6 15" />
          </svg>
        </IconButton>
        <IconButton label="Move down" size="sm" onClick={onMoveDown}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </IconButton>
        <IconButton label="Edit" size="sm" onClick={onEdit}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
          </svg>
        </IconButton>
        <IconButton label="Delete" size="sm" variant="danger" onClick={onDelete}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </IconButton>
      </div>
    </div>
  )
}
