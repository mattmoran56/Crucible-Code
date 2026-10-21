import React, { useEffect, useMemo, useState } from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import { useSchedulerStore } from '../../stores/schedulerStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useUsageStore } from '../../stores/usageStore'
import {
  promptNeedsInput,
  resolveStartupCommand,
  useStartupPromptStore,
} from '../../stores/startupPromptStore'
import type { Project, QueuedSession } from '../../../shared/types'
import { Dialog } from '../ui/Dialog'
import { Input } from '../ui/Input'
import { BranchCombobox } from '../ui/BranchCombobox'
import { Button } from '../ui/Button'
import { nextResetEpochMs, toLocalDateTimeInputValue, fromLocalDateTimeInputValue, formatClockTime } from '../../lib/scheduleTime'

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
  const [scheduleEnabled, setScheduleEnabled] = useState(false)
  const [scheduledForInput, setScheduledForInput] = useState('')
  // Custom-prompt textarea content. Only used when schedule mode is on —
  // chip-driven prompts cover the non-scheduled path.
  const [customPrompt, setCustomPrompt] = useState('')
  const { createSession } = useSessionStore()
  const addQueuedSession = useSchedulerStore((s) => s.addQueuedSession)
  const usageResetDelayMinutes = useSettingsStore((s) => s.usageResetDelayMinutes)
  const sessionUsages = useUsageStore((s) => s.sessionUsages)

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
    setScheduleEnabled(false)
    setScheduledForInput('')
    setCustomPrompt('')
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

  // The earliest known 5h reset across any active session. Drives both the
  // default-fill on schedule toggle and the "Use next reset" preset button.
  const nextResetMs = useMemo(
    () => nextResetEpochMs(Object.values(sessionUsages)),
    [sessionUsages]
  )

  // When the user toggles "Schedule for later" on, pre-fill with the next 5h
  // reset (across any session) plus the configured delay. Falls back to "1
  // hour from now" if no usage data is available yet.
  const scheduleDefault = useMemo(() => {
    if (nextResetMs) return nextResetMs + usageResetDelayMinutes * 60_000
    return Date.now() + 60 * 60_000
  }, [nextResetMs, usageResetDelayMinutes])

  useEffect(() => {
    if (scheduleEnabled && !scheduledForInput) {
      setScheduledForInput(toLocalDateTimeInputValue(scheduleDefault))
    }
  }, [scheduleEnabled, scheduleDefault, scheduledForInput])

  const scheduledForMs = useMemo(
    () => (scheduledForInput ? fromLocalDateTimeInputValue(scheduledForInput) : null),
    [scheduledForInput]
  )

  const scheduleInPast = scheduleEnabled && scheduledForMs != null && scheduledForMs < Date.now() + 30_000
  const scheduleNeedsPrompt = scheduleEnabled && !customPrompt.trim()
  const canSubmit =
    !!name.trim() &&
    !inputMissing &&
    !creating &&
    !scheduleInPast &&
    !scheduleNeedsPrompt &&
    (!scheduleEnabled || scheduledForMs != null)

  // Pre-fill the custom-prompt textarea when the user picks a chip in
  // schedule mode. Resolves `{{input}}` if the chip needs it and the user
  // has typed something; otherwise pastes the raw command so the user can
  // finish editing in the textarea.
  const fillCustomFromChip = (chipId: string) => {
    if (chipId === NONE) {
      setCustomPrompt('')
      return
    }
    const chip = prompts.find((p) => p.id === chipId)
    if (!chip) return
    const resolved = promptInput.trim()
      ? resolveStartupCommand(chip.command, promptInput.trim())
      : chip.command
    setCustomPrompt(resolved)
  }

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!name.trim()) return
    // inputMissing is only enforced for the non-scheduled path — in schedule
    // mode the chip is just a textarea pre-fill helper, not a hard input.
    if (inputMissing && !scheduleEnabled) {
      setShowInputError(true)
      return
    }
    setCreating(true)
    setError(null)
    try {
      if (scheduleEnabled && scheduledForMs != null) {
        // canSubmit ensures customPrompt is non-empty here.
        const queued: QueuedSession = {
          id: crypto.randomUUID(),
          projectId: project.id,
          name: name.trim(),
          baseBranch: baseBranch || undefined,
          startupPrompt: customPrompt.trim(),
          scheduledFor: scheduledForMs,
          createdAt: new Date().toISOString(),
        }
        await addQueuedSession(queued)
      } else {
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
      }
      setName('')
      setBaseBranch('')
      setSelectedPromptId(NONE)
      setPromptInput('')
      setScheduleEnabled(false)
      setScheduledForInput('')
      setCustomPrompt('')
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
            <label className="block text-xs text-text-muted mb-2">
              {scheduleEnabled ? 'Pre-fill from template (optional)' : 'Startup prompt'}
            </label>
            <div className="flex flex-wrap gap-2">
              <PromptChip
                label="None"
                active={selectedPromptId === NONE}
                onClick={() => {
                  setSelectedPromptId(NONE)
                  setPromptInput('')
                  setShowInputError(false)
                  if (scheduleEnabled) fillCustomFromChip(NONE)
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
                    if (scheduleEnabled) fillCustomFromChip(p.id)
                  }}
                />
              ))}
            </div>
            <p className="text-[10px] text-text-muted mt-2">
              {scheduleEnabled
                ? 'Pick a template to populate the prompt below — or skip and write your own.'
                : 'Runs in the agent terminal once Claude is ready.'}
            </p>
          </div>
        )}

        {needsInput && selectedPrompt && !scheduleEnabled && (
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

        <div>
          <label className="flex items-center gap-2 text-xs text-text cursor-pointer select-none">
            <input
              type="checkbox"
              checked={scheduleEnabled}
              onChange={(e) => setScheduleEnabled(e.target.checked)}
              className="cursor-pointer"
            />
            Schedule for later
          </label>
          {scheduleEnabled && (
            <div style={{ marginTop: 8 }} className="flex flex-col gap-3">
              <div>
                <label className="block text-[11px] text-text-muted" style={{ marginBottom: 4 }}>
                  Prompt
                </label>
                <textarea
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder="What should the agent do when it starts?"
                  rows={4}
                  className="w-full bg-bg border border-border rounded-md text-xs text-text focus:outline-none focus:border-accent font-mono resize-y"
                  style={{ padding: '6px 10px' }}
                />
              </div>

              <div>
                <label className="block text-[11px] text-text-muted" style={{ marginBottom: 4 }}>
                  Run at
                </label>
                <div className="flex items-center flex-wrap gap-2">
                  <input
                    type="datetime-local"
                    value={scheduledForInput}
                    onChange={(e) => setScheduledForInput(e.target.value)}
                    className="bg-bg border border-border rounded-md text-xs text-text focus:outline-none focus:border-accent"
                    style={{ padding: '6px 10px' }}
                  />
                  {nextResetMs && (
                    <button
                      type="button"
                      onClick={() => setScheduledForInput(toLocalDateTimeInputValue(nextResetMs + usageResetDelayMinutes * 60_000))}
                      className="text-[11px] rounded-full border border-border text-text-muted hover:text-text hover:border-text-muted transition-colors"
                      style={{ padding: '4px 10px' }}
                      title={`Schedule for ${formatClockTime(nextResetMs + usageResetDelayMinutes * 60_000)} (next 5h reset + ${usageResetDelayMinutes}m)`}
                    >
                      Use next reset ({formatClockTime(nextResetMs + usageResetDelayMinutes * 60_000)})
                    </button>
                  )}
                </div>
              </div>

              {scheduleInPast && (
                <p className="text-[11px] text-danger">
                  Pick a time at least 30 seconds from now.
                </p>
              )}
              {scheduleNeedsPrompt && !scheduleInPast && (
                <p className="text-[11px] text-danger">
                  Scheduled sessions need a prompt — type one above.
                </p>
              )}
              {!scheduleInPast && !scheduleNeedsPrompt && (
                <p className="text-[11px] text-text-muted">
                  Worktree, branch, and agent will be created at that time.
                </p>
              )}
            </div>
          )}
        </div>

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
            {scheduleEnabled ? 'Schedule' : 'Create'}
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
