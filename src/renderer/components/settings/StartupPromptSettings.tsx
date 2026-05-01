import React, { useEffect, useMemo, useState } from 'react'
import type { Project, StartupPrompt } from '../../../shared/types'
import { useStartupPromptStore } from '../../stores/startupPromptStore'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import { Dialog } from '../ui/Dialog'
import { Input } from '../ui/Input'

interface Props {
  projects: Project[]
}

interface FormState {
  label: string
  command: string
  inputLabel: string
  inputPlaceholder: string
}

const emptyForm: FormState = {
  label: '',
  command: '',
  inputLabel: '',
  inputPlaceholder: '',
}

function promptToForm(p: StartupPrompt): FormState {
  return {
    label: p.label,
    command: p.command,
    inputLabel: p.inputLabel ?? '',
    inputPlaceholder: p.inputPlaceholder ?? '',
  }
}

function formToPrompt(form: FormState, existing?: StartupPrompt, order = 0): StartupPrompt {
  const command = form.command
  const hasInput = /\{\{input\}\}/.test(command)
  return {
    id: existing?.id ?? crypto.randomUUID(),
    label: form.label.trim(),
    command,
    inputLabel: hasInput && form.inputLabel.trim() ? form.inputLabel.trim() : undefined,
    inputPlaceholder: hasInput && form.inputPlaceholder.trim() ? form.inputPlaceholder.trim() : undefined,
    order: existing?.order ?? order,
  }
}

export function StartupPromptSettings({ projects }: Props) {
  const load = useStartupPromptStore((s) => s.load)

  // Lazily load each project's prompt list when this section mounts.
  useEffect(() => {
    for (const p of projects) load(p.id)
  }, [projects, load])

  if (projects.length === 0) return null

  return (
    <div style={{ marginTop: 40 }}>
      <h1 className="text-lg font-semibold text-text" style={{ marginBottom: 4 }}>
        Session Startup Prompts
      </h1>
      <p className="text-xs text-text-muted" style={{ marginBottom: 20 }}>
        Configure prompts that can be auto-run in a new session's agent terminal. Use{' '}
        <code className="text-text">{'{{input}}'}</code> in the command to ask for an input value when the
        session is created.
      </p>

      <div className="flex flex-col gap-2">
        {projects.map((project) => (
          <ProjectCard key={project.id} project={project} />
        ))}
      </div>
    </div>
  )
}

interface ProjectCardProps {
  project: Project
}

function ProjectCard({ project }: ProjectCardProps) {
  const promptsByProject = useStartupPromptStore((s) => s.byProject)
  const add = useStartupPromptStore((s) => s.add)
  const update = useStartupPromptStore((s) => s.update)
  const remove = useStartupPromptStore((s) => s.remove)
  const prompts = useMemo(
    () => promptsByProject[project.id] ?? [],
    [promptsByProject, project.id]
  )

  const [editing, setEditing] = useState<StartupPrompt | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)

  const openEditor = (prompt: StartupPrompt | null) => {
    if (prompt) {
      setEditing(prompt)
      setCreating(false)
      setForm(promptToForm(prompt))
    } else {
      setEditing(null)
      setCreating(true)
      setForm(emptyForm)
    }
  }

  const closeEditor = () => {
    setEditing(null)
    setCreating(false)
    setForm(emptyForm)
  }

  const canSave = !!form.label.trim() && !!form.command.trim()

  const handleSave = async () => {
    if (!canSave) return
    if (editing) {
      await update(project.id, formToPrompt(form, editing))
    } else {
      await add(project.id, formToPrompt(form, undefined, prompts.length))
    }
    closeEditor()
  }

  const dialogOpen = creating || editing !== null
  const hasInput = /\{\{input\}\}/.test(form.command)

  return (
    <div className="border border-border rounded-md" style={{ padding: '10px 14px' }}>
      <div className="flex items-center justify-between" style={{ marginBottom: prompts.length > 0 ? 8 : 0 }}>
        <div className="min-w-0">
          <p className="text-xs font-medium text-text truncate">{project.name}</p>
          <p className="text-[10px] text-text-muted truncate">{project.repoPath}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => openEditor(null)}
          className="border border-border shrink-0"
          style={{ padding: '4px 10px' }}
        >
          + Add prompt
        </Button>
      </div>

      {prompts.length > 0 && (
        <div className="flex flex-col gap-1">
          {prompts.map((prompt) => (
            <PromptRow
              key={prompt.id}
              prompt={prompt}
              onEdit={() => openEditor(prompt)}
              onDelete={() => remove(project.id, prompt.id)}
            />
          ))}
        </div>
      )}

      <Dialog
        open={dialogOpen}
        onClose={closeEditor}
        title={editing ? 'Edit prompt' : 'Add prompt'}
        width="28rem"
      >
        <div className="flex flex-col gap-3">
          <Input
            label="Label"
            placeholder="e.g. Notion Ticket"
            value={form.label}
            onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
          />
          <div>
            <label className="block text-xs text-text-muted mb-1.5">Command</label>
            <textarea
              value={form.command}
              onChange={(e) => setForm((f) => ({ ...f, command: e.target.value }))}
              placeholder="/notion-ticket {{input}}"
              rows={3}
              className="w-full bg-bg border border-border rounded-md text-xs text-text font-mono focus:outline-none focus:border-accent"
              style={{ padding: '8px 14px', resize: 'vertical' }}
            />
            <p className="text-[10px] text-text-muted mt-1">
              Use <code>{'{{input}}'}</code> to prompt the user for an input when starting the session.
            </p>
          </div>

          {hasInput && (
            <>
              <Input
                label="Input field label"
                placeholder="e.g. Notion ticket URL"
                value={form.inputLabel}
                onChange={(e) => setForm((f) => ({ ...f, inputLabel: e.target.value }))}
              />
              <Input
                label="Input placeholder (optional)"
                placeholder="https://notion.so/…"
                value={form.inputPlaceholder}
                onChange={(e) => setForm((f) => ({ ...f, inputPlaceholder: e.target.value }))}
              />
            </>
          )}

          <div className="flex justify-end gap-2" style={{ marginTop: 4 }}>
            <Button variant="ghost" onClick={closeEditor}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSave} disabled={!canSave}>
              {editing ? 'Save' : 'Create'}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}

interface PromptRowProps {
  prompt: StartupPrompt
  onEdit: () => void
  onDelete: () => void
}

function PromptRow({ prompt, onEdit, onDelete }: PromptRowProps) {
  const hasInput = /\{\{input\}\}/.test(prompt.command)
  return (
    <div
      className="flex items-center justify-between group hover:bg-bg-tertiary rounded"
      style={{ padding: '6px 8px' }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs text-text truncate">{prompt.label}</span>
          {hasInput && (
            <span className="text-[10px] text-text-muted px-1.5 py-0.5 rounded bg-bg-secondary border border-border">
              needs input
            </span>
          )}
        </div>
        <p className="text-[10px] text-text-muted font-mono truncate">{prompt.command}</p>
      </div>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <IconButton label="Edit" size="sm" onClick={onEdit}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
          </svg>
        </IconButton>
        <IconButton label="Delete" size="sm" variant="danger" onClick={onDelete}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </IconButton>
      </div>
    </div>
  )
}
