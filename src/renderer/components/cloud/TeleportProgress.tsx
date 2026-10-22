// The Agent tab while a teleport runs: the steps `claude --teleport` reports,
// over the PTY it runs in. The terminal stays mounted (hidden) so nothing it
// prints is lost; it is revealed on demand, and on its own when the CLI asks
// something, when it is handed over (the REPL has the conversation but Claude
// has not saved it yet) or stalls, and when the teleport fails. When the
// conversation is local the tab switches to the visual agent
// (lib/cloudTeleport) — this view goes away; if it ends with nothing saved,
// the session goes back to the cloud page.

import React, { useEffect, useState } from 'react'
import type { CloudTeleportState } from '../../../shared/types'
import { cn } from '../../lib/cn'
import { TerminalView } from '../terminal/TerminalView'
import { focusTerminal } from '../terminal/useTerminal'
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
          : 'Send a message in the terminal below. Claude saves the conversation locally only after your first message; then you can open it in the Agent view'
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
  const canLeave = !!onFinish && (status === 'needs-input' || (status === 'running' && resumed))
  // Only a conversation Claude has saved locally can open in the Agent view.
  // Before that, leaving closes the CLI and abandons the teleport (the session
  // stays in the cloud), so it is offered as Cancel, never as "Open in Agent
  // view" — clicking that and watching the CLI terminate read as a crash.
  const saved = !!run?.claudeSessionId
  // Handed over with nothing saved yet: the user has to send a message in the
  // terminal. Easy to miss in the status line, so say it right above the
  // terminal too, and put the cursor there.
  const needsMessage = status === 'needs-input' && waiting === 'first-message' && !saved
  useEffect(() => {
    if (!visible || !showTerminal || status !== 'needs-input' || saved) return
    const raf = requestAnimationFrame(() => focusTerminal(terminalId))
    return () => cancelAnimationFrame(raf)
  }, [visible, showTerminal, status, waiting, saved, terminalId])

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
        {canLeave && saved ? (
          <button
            type="button"
            onClick={onFinish}
            className={BTN}
            title="Close the terminal and continue in the Agent view"
            data-testid="teleport-finish"
          >
            Open in Agent view
          </button>
        ) : null}
        {canLeave && !saved ? (
          <button
            type="button"
            onClick={onFinish}
            className={BTN}
            title="Close the terminal and stop the teleport. Nothing is saved locally yet, so the session stays in the cloud. To bring it here, send a message in the terminal first."
            data-testid="teleport-cancel"
          >
            Cancel teleport
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

      {needsMessage && showTerminal ? (
        <div
          role="alert"
          className="flex shrink-0 items-center gap-2 border-b border-accent bg-accent/20 px-3! py-2! text-[13px] font-medium text-text"
          data-testid="teleport-send-message"
        >
          <TeleportIcon size={14} className="shrink-0 text-accent" />
          <span>
            Send any message below to finish bringing this session down.
            <span className="ml-1 font-normal text-text-muted">
              Type it in the terminal and press Enter: Claude writes the conversation to this machine only once you do.
            </span>
          </span>
        </div>
      ) : null}

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
