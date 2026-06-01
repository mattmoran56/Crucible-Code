import { useEffect, useMemo, useState } from 'react'
import { Input } from '@renderer/components/ui/Input'
import { Button } from '@renderer/components/ui/Button'
import { BranchCombobox } from '@renderer/components/ui/BranchCombobox'
import {
  promptNeedsInput,
  resolveStartupCommand,
} from '@renderer/stores/startupPromptStore'
import type { StartupPrompt } from '@shared/types'
import { api } from '../api/wsClient'

interface Project {
  id: string
  name: string
  path: string
}

interface Props {
  project: Project
  onCancel: () => void
  onCreated: (session: { id: string; name: string; branchName: string; worktreePath: string }) => void
}

const NONE = '__none__'

export function NewSessionPage({ project, onCancel, onCreated }: Props) {
  const [name, setName] = useState('')
  const [baseBranch, setBaseBranch] = useState('')
  const [branches, setBranches] = useState<string[]>([])
  const [branchesLoading, setBranchesLoading] = useState(false)
  const [prompts, setPrompts] = useState<StartupPrompt[]>([])
  const [selectedPromptId, setSelectedPromptId] = useState<string>(NONE)
  const [promptInput, setPromptInput] = useState('')
  const [showInputError, setShowInputError] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setName('')
    setError(null)
    setSelectedPromptId(NONE)
    setPromptInput('')
    setShowInputError(false)
    setBranchesLoading(true)
    Promise.all([
      api.git.defaultBranch(project.path),
      api.git.listBranches(project.path),
      api.startupPrompts.list(project.id),
    ])
      .then(([def, list, p]) => {
        setBaseBranch(def)
        setBranches(list)
        setPrompts(p)
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBranchesLoading(false))
  }, [project.id, project.path])

  const selectedPrompt = useMemo(
    () => (selectedPromptId === NONE ? null : prompts.find((p) => p.id === selectedPromptId) ?? null),
    [selectedPromptId, prompts]
  )
  const needsInput = !!selectedPrompt && promptNeedsInput(selectedPrompt.command)
  const inputMissing = needsInput && !promptInput.trim()

  const canSubmit = !!name.trim() && !inputMissing && !creating

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!name.trim() || creating) return
    if (inputMissing) {
      setShowInputError(true)
      return
    }
    setCreating(true)
    setError(null)
    try {
      const startupCommand = selectedPrompt
        ? resolveStartupCommand(selectedPrompt.command, promptInput.trim())
        : undefined
      const session = await api.sessions.create(
        project.id,
        project.path,
        name.trim(),
        baseBranch || undefined,
        startupCommand
      )
      onCreated(session)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-bg">
      <div className="max-w-2xl mx-auto" style={{ padding: '32px 24px 48px' }}>
        {/* Project header */}
        <div style={{ marginBottom: 28 }}>
          <div className="text-[11px] uppercase tracking-wider text-text-muted font-medium" style={{ marginBottom: 4 }}>
            New session in
          </div>
          <div className="text-2xl font-semibold text-text">{project.name}</div>
          <div className="text-xs text-text-muted font-mono truncate" style={{ marginTop: 4 }}>
            {project.path}
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-bg-secondary border border-border rounded-md flex flex-col gap-5"
          style={{ padding: 20 }}
        >
          <Input
            label="Session name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. fix-auth-bug"
            error={error || undefined}
          />

          <BranchCombobox
            label="Base branch"
            hint="Branch to create the new session from"
            value={baseBranch}
            onChange={setBaseBranch}
            onSelect={setBaseBranch}
            branches={branches}
            loading={branchesLoading}
            placeholder="main"
          />

          {prompts.length > 0 && (
            <div>
              <label className="block text-xs text-text-muted" style={{ marginBottom: 8 }}>
                Startup prompt
              </label>
              <div className="flex flex-wrap gap-2">
                <PromptChip
                  label="None"
                  active={selectedPromptId === NONE}
                  onClick={() => {
                    setSelectedPromptId(NONE)
                    setPromptInput('')
                    setShowInputError(false)
                  }}
                />
                {prompts.map((p) => (
                  <PromptChip
                    key={p.id}
                    label={p.label}
                    active={selectedPromptId === p.id}
                    onClick={() => {
                      setSelectedPromptId(p.id)
                      setShowInputError(false)
                    }}
                  />
                ))}
              </div>
              <p className="text-[10px] text-text-muted" style={{ marginTop: 8 }}>
                Runs in the agent terminal once Claude is ready.
              </p>
            </div>
          )}

          {needsInput && selectedPrompt && (
            <Input
              label={selectedPrompt.inputLabel || 'Input'}
              value={promptInput}
              onChange={(e) => {
                setPromptInput(e.target.value)
                if (showInputError && e.target.value.trim()) setShowInputError(false)
              }}
              placeholder={selectedPrompt.inputPlaceholder}
              error={showInputError ? 'This prompt requires an input' : undefined}
            />
          )}

          <div className="flex gap-3 justify-end" style={{ marginTop: 4 }}>
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={!canSubmit}
              loading={creating}
            >
              Create session
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

interface PromptChipProps {
  label: string
  active: boolean
  onClick: () => void
}

function PromptChip({ label, active, onClick }: PromptChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-xs rounded-full border transition-colors ${
        active
          ? 'border-accent bg-accent/10 text-accent'
          : 'border-border text-text-muted hover:text-text hover:border-text-muted'
      }`}
      style={{ padding: '4px 10px' }}
    >
      {label}
    </button>
  )
}
