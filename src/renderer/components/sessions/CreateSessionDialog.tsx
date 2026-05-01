import React, { useEffect, useMemo, useState } from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import {
  promptNeedsInput,
  resolveStartupCommand,
  useStartupPromptStore,
} from '../../stores/startupPromptStore'
import type { Project } from '../../../shared/types'
import { Dialog } from '../ui/Dialog'
import { Input } from '../ui/Input'
import { BranchCombobox } from '../ui/BranchCombobox'
import { Button } from '../ui/Button'

interface Props {
  open: boolean
  project: Project
  onClose: () => void
}

const NONE = '__none__'

export function CreateSessionDialog({ open, project, onClose }: Props) {
  const [name, setName] = useState('')
  const [baseBranch, setBaseBranch] = useState('')
  const [branches, setBranches] = useState<string[]>([])
  const [branchesLoading, setBranchesLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedPromptId, setSelectedPromptId] = useState<string>(NONE)
  const [promptInput, setPromptInput] = useState('')
  const [showInputError, setShowInputError] = useState(false)
  const { createSession } = useSessionStore()

  const loadPrompts = useStartupPromptStore((s) => s.load)
  const promptsByProject = useStartupPromptStore((s) => s.byProject)
  const prompts = useMemo(
    () => promptsByProject[project.id] ?? [],
    [promptsByProject, project.id]
  )

  const selectedPrompt = useMemo(
    () => (selectedPromptId === NONE ? null : prompts.find((p) => p.id === selectedPromptId) ?? null),
    [selectedPromptId, prompts]
  )
  const needsInput = !!selectedPrompt && promptNeedsInput(selectedPrompt.command)
  const inputMissing = needsInput && !promptInput.trim()

  // Fetch default branch and branch list when dialog opens
  useEffect(() => {
    if (!open) return
    setName('')
    setError(null)
    setSelectedPromptId(NONE)
    setPromptInput('')
    setShowInputError(false)
    setBranchesLoading(true)
    Promise.all([
      window.api.git.defaultBranch(project.repoPath),
      window.api.git.listBranches(project.repoPath),
      loadPrompts(project.id),
    ]).then(([defaultBranch, list]) => {
      setBaseBranch(defaultBranch)
      setBranches(list)
      setBranchesLoading(false)
    }).catch(() => setBranchesLoading(false))
  }, [open, project.id, project.repoPath, loadPrompts])

  const canSubmit = !!name.trim() && !inputMissing && !creating

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!name.trim()) return
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
      await createSession(
        project.id,
        project.repoPath,
        name.trim(),
        baseBranch || undefined,
        startupCommand
      )
      setName('')
      setBaseBranch('')
      setSelectedPromptId(NONE)
      setPromptInput('')
      onClose()
    } catch (err: any) {
      setError(err.message || 'Failed to create session')
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="New Session">
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
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
            <label className="block text-xs text-text-muted mb-2">Startup prompt</label>
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
            <p className="text-[10px] text-text-muted mt-2">
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
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={!canSubmit}
            loading={creating}
          >
            Create
          </Button>
        </div>
      </form>
    </Dialog>
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
