// The Agent tab while a teleport runs: the steps `claude --teleport` reports,
// over the PTY it runs in. The terminal stays mounted (hidden) so nothing it
// prints is lost; it is revealed on demand, and on its own when the CLI asks
// something, when it is handed over (the REPL has the conversation but Claude
// has not saved it yet) or stalls, and when the teleport fails. When the
// conversation is local the tab switches to the visual agent
// (lib/cloudTeleport) — this view goes away.

import React, { useEffect, useState } from 'react'
import type { CloudTeleportState } from '../../../shared/types'
import { cn } from '../../lib/cn'
import { TerminalView } from '../terminal/TerminalView'
import { Check, Spinner } from '../visual-agent/icons'
import { TeleportIcon } from './icons'

/** The CLI's progress lines (cloud-teleport.service) and how we show them. */
export const TELEPORT_STEPS: Array<{ cli: string; label: string }> = [
  { cli: 'Validating session', label: 'Validating the cloud session' },
  { cli: 'Fetching session logs', label: 'Fetching the conversation' },
  { cli: 'Getting branch info', label: 'Getting branch info' },
  { cli: 'Checking out branch', label: 'Checking out the branch' },
  { cli: 'Session resumed', label: 'Loading the conversation locally' },
]
const OPENING_LABEL = 'Opening it in the Agent view'

type StepState = 'done' | 'active' | 'todo'

/** Each step's state: everything up to the furthest step seen is done; the next is active. */
export function teleportStepStates(run: CloudTeleportState | null): Array<{ label: string; state: StepState }> {
  const seen = run?.steps ?? []
  let furthest = -1
  TELEPORT_STEPS.forEach((s, i) => {
    if (seen.includes(s.cli)) furthest = i
  })
  const finishing = run?.status === 'finishing' || run?.status === 'done'
  const moving = run?.status === 'running' || run?.status === 'needs-input' || !run
  const rows = TELEPORT_STEPS.map((s, i) => ({
    label: s.label,
    state: (finishing || i <= furthest ? 'done' : i === furthest + 1 && moving ? 'active' : 'todo') as StepState,
  }))
  rows.push({ label: OPENING_LABEL, state: run?.status === 'done' ? 'done' : finishing ? 'active' : 'todo' })
  return rows
}

const headline = (run: CloudTeleportState | null): string => {
  switch (run?.status) {
    case 'needs-input':
      if (run.waiting === 'first-message') {
        return run.claudeSessionId
          ? 'Saved locally — open it in the Agent view when this turn is done'
          : 'The conversation is loaded in the terminal. Claude saves it locally after your first message — send one below, then open it in the Agent view'
      }
      if (run.waiting === 'timeout') return 'This is taking longer than expected — check the terminal below'
      return 'Claude needs your input — answer in the terminal below'
    case 'finishing':
    case 'done':
      return 'Opening the teleported conversation…'
    case 'failed':
      return "The teleport didn't finish"
    default:
      return 'Teleporting this session to your machine…'
  }
}

const BTN =
  'inline-flex items-center gap-1 rounded-md border border-border px-2! py-[2px]! text-[11px] text-text-muted transition-colors hover:border-accent hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent'

export interface TeleportProgressProps {
  run: CloudTeleportState | null
  terminalId: string
  sessionId: string
  sessionName: string
  visible: boolean
  /** Close the PTY now and open the conversation in the Agent view. */
  onFinish?: () => void
}

export function TeleportProgress({ run, terminalId, sessionId, sessionName, visible, onFinish }: TeleportProgressProps) {
  const [showTerminal, setShowTerminal] = useState(false)
  const status = run?.status ?? 'running'
  // Reveal the terminal when the CLI waits on the user (for any reason —
  // re-reveal when the reason changes) or the run failed.
  const waiting = run?.waiting
  useEffect(() => {
    if (status === 'needs-input' || status === 'failed') setShowTerminal(true)
  }, [status, waiting])

  const busy = status === 'running' || status === 'finishing' || status === 'done'
  const resumed = run?.steps.includes('Session resumed') ?? false
  const canFinish = !!onFinish && (status === 'needs-input' || (status === 'running' && resumed))
  // Leaving before Claude saved the conversation starts a fresh agent.
  const finishTitle =
    run?.claudeSessionId || !run?.waiting || run.waiting === 'prompt'
      ? 'Close the terminal and continue in the Agent view'
      : 'Close the terminal and open the Agent view. Nothing is saved locally yet, so it starts a fresh agent (the conversation stays in the cloud).'

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="teleport-progress">
      <div
        role="status"
        className={cn(
          'flex shrink-0 items-center gap-2 border-b px-3! py-1.5! text-[11.5px]',
          status === 'needs-input'
            ? 'border-accent/50 bg-accent/10 text-text'
            : status === 'failed'
              ? 'border-danger/40 bg-danger/10 text-text'
              : 'border-border bg-bg-secondary text-text-muted'
        )}
      >
        {busy ? <Spinner className="text-accent" /> : <TeleportIcon size={12} className="text-accent" />}
        <span className="min-w-0 flex-1">{headline(run)}</span>
        {canFinish ? (
          <button type="button" onClick={onFinish} className={BTN} title={finishTitle} data-testid="teleport-finish">
            Open in Agent view
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => setShowTerminal((v) => !v)}
          className={BTN}
          aria-expanded={showTerminal}
          data-testid="teleport-terminal-toggle"
        >
          {showTerminal ? 'Hide terminal' : 'Show terminal'}
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        <TerminalView terminalId={terminalId} sessionId={sessionId} sessionName={sessionName} visible={visible && showTerminal} />
        {!showTerminal ? (
          <div className="absolute inset-0 flex items-center justify-center bg-bg">
            <ol className="flex flex-col gap-2 text-[12.5px]" aria-label="Teleport progress">
              {teleportStepStates(run).map((step) => (
                <li
                  key={step.label}
                  className={cn('flex items-center gap-2', step.state === 'todo' ? 'text-text-muted/60' : 'text-text')}
                  data-state={step.state}
                >
                  <span className="flex w-4 justify-center">
                    {step.state === 'done' ? (
                      <Check size={12} className="text-accent" />
                    ) : step.state === 'active' ? (
                      status === 'needs-input' || status === 'failed' ? (
                        <span className="h-1.5 w-1.5 rounded-full bg-text-muted" />
                      ) : (
                        <Spinner className="text-accent" />
                      )
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full bg-border" />
                    )}
                  </span>
                  {step.label}
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </div>
    </div>
  )
}
