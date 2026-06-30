import React, { useEffect, useRef } from 'react'
import { useReviewLoopStore } from '../../stores/reviewLoopStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useProjectStore } from '../../stores/projectStore'
import { usePRStore } from '../../stores/prStore'
import { useTerminalStore } from '../../stores/terminalStore'
import { TerminalView } from '../terminal/TerminalView'
import { Button } from '../ui/Button'
import type {
  ReviewLoopPhaseSlot,
  ReviewLoopRound,
  ReviewLoopState,
  ReviewLoopStopReason,
  ReviewLoopTriagedIssue,
  ReviewLoopVariant,
} from '../../../shared/types'

interface Props {
  visible?: boolean
}

const PHASE_LABEL: Record<ReviewLoopPhaseSlot['phase'], string> = {
  review: 'Review',
  triage: 'Triage',
  fix: 'Implementation',
}

const PHASE_ORDER: ReviewLoopPhaseSlot['phase'][] = ['review', 'triage', 'fix']

export function ReviewLoopPanel({ visible = true }: Props) {
  const { activeSessionId, sessions } = useSessionStore()
  const { projects, activeProjectId } = useProjectStore()
  const { pullRequests } = usePRStore()
  const states = useReviewLoopStore((s) => s.states)
  const effectiveConfig = useReviewLoopStore((s) => s.effectiveConfig)
  const start = useReviewLoopStore((s) => s.start)
  const cancel = useReviewLoopStore((s) => s.cancel)
  const refreshState = useReviewLoopStore((s) => s.refreshState)

  const session = sessions.find((s) => s.id === activeSessionId)
  const project = projects.find((p) => p.id === activeProjectId)
  const config = effectiveConfig(activeProjectId)
  const state = activeSessionId ? states[activeSessionId] : undefined

  useEffect(() => {
    if (activeSessionId) refreshState(activeSessionId)
  }, [activeSessionId, refreshState])

  if (!visible) return null

  if (!session || !project) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-xs">
        Select a session to use the review loop
      </div>
    )
  }

  const sessionPR = pullRequests.find((pr) => pr.headRefName === session.branchName)
  const baseBranch = session.baseBranch ?? sessionPR?.baseRefName ?? 'main'

  const isRunning = state?.status === 'running'

  const handleStart = () => {
    void start({
      sessionId: session.id,
      worktreePath: session.worktreePath,
      branch: session.branchName,
      baseBranch,
      projectId: project.id,
      prNumber: sessionPR?.number ?? session.prNumber,
    })
  }

  const handleCancel = () => {
    void cancel(session.id)
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center gap-3 border-b border-border bg-bg-secondary"
        style={{ padding: '10px 14px' }}
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-text">Review Loop</p>
          <p className="text-[11px] text-text-muted truncate">
            <code>{session.branchName}</code> → <code>{baseBranch}</code>
            {' · '}max {config.maxIterations} rounds · stop after {config.consecutiveCleanRounds} clean
          </p>
        </div>
        {!config.enabled ? (
          <span className="text-[11px] text-warning">Disabled for this project</span>
        ) : isRunning ? (
          <Button variant="danger" size="sm" onClick={handleCancel}>
            Cancel
          </Button>
        ) : (
          <Button variant="primary" size="sm" onClick={handleStart}>
            Start review loop
          </Button>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto" style={{ padding: 14 }}>
        {state ? (
          <LoopStateView state={state} sessionName={session.name} panelVisible={visible} />
        ) : (
          <EmptyState variant={config.variant} headless={config.headless} />
        )}
      </div>
    </div>
  )
}

function EmptyState({ variant, headless }: { variant: ReviewLoopVariant; headless: boolean }) {
  if (variant === 'efficient') {
    return (
      <div className="text-xs text-text-muted">
        <p>
          Press <strong>Start review loop</strong> to begin. The <strong>Efficient</strong> variant
          splits work across two panels:
        </p>
        <ul style={{ marginTop: 8, paddingLeft: 18, listStyle: 'disc' }}>
          <li><strong>Left</strong> — a fresh, headless <code>claude -p</code> <strong>review</strong> per round, stacked. Clear context every time so reviews stay unbiased.</li>
          <li><strong>Right</strong> — one <strong>live, interactive</strong> worker terminal that triages then implements every round, keeping its context across the whole loop (so it remembers what it already chose to skip).</li>
        </ul>
        <p style={{ marginTop: 12 }}>
          Each round: a new review streams in on the left, gets handed to the worker on the right to
          triage, then to implement, commit, and push. The loop stops after consecutive clean rounds
          (no new commit), the iteration cap, or manual cancel.
        </p>
      </div>
    )
  }
  return (
    <div className="text-xs text-text-muted">
      <p>
        Press <strong>Start review loop</strong> to begin. Each round runs three phases{' '}
        {headless ? (
          <>as background <code>claude -p</code> runs — the panel streams each transcript:</>
        ) : (
          <>as live Claude Code terminals you can watch and type into:</>
        )}
      </p>
      <ol style={{ marginTop: 8, paddingLeft: 18 }}>
        <li><strong>Review</strong> — Claude reviews the diff vs. base{variant === 'lite' ? ' (via /review on the PR)' : ' and records findings'}.</li>
        <li><strong>Triage</strong> — sub-agents investigate each finding and decide fix / skip / defer.</li>
        <li><strong>Implementation</strong> — Claude applies the fixes, commits, and pushes.</li>
      </ol>
      <p style={{ marginTop: 12 }}>
        {headless
          ? 'Headless runs use no pseudo-terminal, so many loops can run at once without hitting the macOS PTY limit. '
          : 'Each terminal freezes (read-only) when its phase finishes; the next phase starts in a fresh column. '}
        A new row of three columns opens for every round.
        The loop stops after consecutive clean rounds, the iteration cap, or manual cancel.
        {variant === 'pro' ? ' Skipped or deferred items get summarised in a sticky comment on the PR.' : ''}
        {' '}You can switch between headless and interactive in Settings → Review Loop.
      </p>
    </div>
  )
}

function LoopStateView({
  state,
  sessionName,
  panelVisible,
}: {
  state: ReviewLoopState
  sessionName: string
  panelVisible: boolean
}) {
  if ((state.variant ?? 'pro') === 'efficient') {
    return (
      <div className="flex flex-col gap-3">
        <SummaryBar state={state} />
        {state.rounds.length === 0 && state.status === 'running' && (
          <p className="text-xs text-text-muted">Starting first review…</p>
        )}
        <EfficientLoopView state={state} sessionName={sessionName} panelVisible={panelVisible} />
      </div>
    )
  }

  // Newest round first so the active round is at the top of the scroll area.
  const reversed = [...state.rounds].reverse()
  return (
    <div className="flex flex-col gap-3">
      <SummaryBar state={state} />
      {state.rounds.length === 0 && state.status === 'running' && (
        <p className="text-xs text-text-muted">Starting first round…</p>
      )}
      {reversed.map((round) => (
        <RoundRow
          key={round.index}
          round={round}
          variant={state.variant ?? 'pro'}
          sessionId={state.sessionId}
          sessionName={sessionName}
          panelVisible={panelVisible}
        />
      ))}
    </div>
  )
}

/**
 * Efficient variant layout: stacked headless reviews on the left (one per
 * round, fresh context), a single persistent interactive worker on the right
 * (triage + implementation for every round, context kept across the loop).
 */
function EfficientLoopView({
  state,
  sessionName,
  panelVisible,
}: {
  state: ReviewLoopState
  sessionName: string
  panelVisible: boolean
}) {
  const register = useTerminalStore((s) => s.registerDynamicTerminal)

  // Attach the renderer store to the persistent worker PTY the main process spawned.
  useEffect(() => {
    if (state.persistentTerminalId && state.persistentTabId) {
      register(
        state.persistentTabId,
        state.persistentTerminalId,
        state.sessionId,
        sessionName,
        'claude',
        state.sessionId
      )
    }
  }, [state.persistentTerminalId, state.persistentTabId, state.sessionId, sessionName, register])

  // Newest round at the top of the review stack.
  const reversedRounds = [...state.rounds].reverse()
  const workerActive = state.status === 'running' && (state.currentPhase === 'triage' || state.currentPhase === 'fix')

  return (
    <div className="flex gap-2" style={{ minHeight: 460 }}>
      {/* Left: stacked fresh reviews */}
      <div className="flex flex-col min-w-0 border border-border rounded overflow-hidden bg-bg-tertiary" style={{ width: '42%', minWidth: 240 }}>
        <div className="border-b border-border bg-bg-secondary" style={{ padding: '4px 8px' }}>
          <span className="text-[11px] font-medium text-text">Reviews</span>
          <span className="text-[10px] text-text-muted"> · fresh context each round</span>
        </div>
        <div className="flex-1 overflow-y-auto flex flex-col gap-2" style={{ padding: 6, minHeight: 0 }}>
          {reversedRounds.length === 0 && (
            <p className="text-[11px] text-text-muted" style={{ padding: 4 }}>No reviews yet.</p>
          )}
          {reversedRounds.map((round) => {
            const review = round.phaseSlots.find((s) => s.phase === 'review')
            return (
              <div key={round.index} className="border border-border rounded overflow-hidden flex flex-col" style={{ minHeight: 160 }}>
                <div className="flex items-center justify-between gap-2 border-b border-border bg-bg-secondary" style={{ padding: '3px 8px' }}>
                  <span className="text-[11px] font-medium text-text">Round {round.index} review</span>
                  <PhasePill status={review?.status ?? 'pending'} />
                </div>
                <div className="relative flex-1" style={{ minHeight: 120 }}>
                  <HeadlessTranscript
                    lines={review?.transcript ?? []}
                    status={review?.status ?? 'pending'}
                    error={review?.errorMessage}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Right: the single persistent interactive worker */}
      <div className="flex-1 flex flex-col min-w-0 border border-border rounded overflow-hidden bg-bg-tertiary" style={{ minWidth: 280 }}>
        <div className="flex items-center justify-between gap-2 border-b border-border bg-bg-secondary" style={{ padding: '4px 8px' }}>
          <span className="text-[11px] font-medium text-text">
            Worker <span className="text-text-muted">· triage + implementation (context kept)</span>
          </span>
          {workerActive && <PhasePill status="running" />}
        </div>
        <div className="flex-1 relative" style={{ minHeight: 0 }}>
          {state.persistentTerminalId ? (
            <TerminalView
              terminalId={state.persistentTerminalId}
              sessionId={state.sessionId}
              sessionName={sessionName}
              visible={panelVisible}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-[11px] text-text-muted">
              {state.status === 'running' ? 'Waiting for the first review…' : 'Worker not started.'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function SummaryBar({ state }: { state: ReviewLoopState }) {
  const status = state.status
  const phase = state.currentPhase
  const variant = state.variant ?? 'pro'

  return (
    <div className="border border-border rounded-md" style={{ padding: '10px 12px' }}>
      <div className="flex items-center gap-3 flex-wrap">
        <StatusPill status={status} phase={phase} />
        <span className="text-[10px] uppercase tracking-wide text-text-muted border border-border rounded px-1.5">
          {variant}
        </span>
        <span className="text-[11px] text-text-muted">
          Round {state.iteration}
        </span>
        {state.stopReason && (
          <span className="text-[11px] text-text-muted">
            Stopped: {stopReasonLabel(state.stopReason)}
          </span>
        )}
        {state.errorMessage && (
          <span className="text-[11px] text-danger">{state.errorMessage}</span>
        )}
      </div>
      {variant === 'pro' && state.skippedIssues.length > 0 && (
        <p className="text-[11px] text-text-muted" style={{ marginTop: 6 }}>
          {state.skippedIssues.length} skipped/deferred {state.skippedIssues.length === 1 ? 'item' : 'items'} will be posted to the PR.
        </p>
      )}
    </div>
  )
}

function StatusPill({
  status,
  phase,
}: {
  status: ReviewLoopState['status']
  phase: ReviewLoopState['currentPhase']
}) {
  let color = 'text-text-muted bg-bg-tertiary'
  let label: string = status
  if (status === 'running') {
    color = 'text-accent border border-accent/40 bg-accent/10'
    label = `running · ${phase}`
  } else if (status === 'completed') {
    color = 'text-success border border-success/40 bg-success/10'
  } else if (status === 'cancelled') {
    color = 'text-warning border border-warning/40 bg-warning/10'
  } else if (status === 'error') {
    color = 'text-danger border border-danger/40 bg-danger/10'
  }
  return (
    <span
      className={`inline-flex items-center text-[11px] font-medium rounded-full uppercase tracking-wide ${color}`}
      style={{ padding: '2px 8px' }}
    >
      {label}
    </span>
  )
}

function stopReasonLabel(r: ReviewLoopStopReason): string {
  switch (r) {
    case 'converged': return 'converged (consecutive clean rounds)'
    case 'maxIterations': return 'iteration cap reached'
    case 'cancelled': return 'cancelled'
    case 'error': return 'error'
  }
}

function RoundRow({
  round,
  variant,
  sessionId,
  sessionName,
  panelVisible,
}: {
  round: ReviewLoopRound
  variant: ReviewLoopVariant
  sessionId: string
  sessionName: string
  panelVisible: boolean
}) {
  const fixCount = round.triaged.filter((t) => t.decision === 'fix').length
  const skipCount = round.triaged.filter(
    (t) => t.decision === 'skip' || t.decision === 'defer'
  ).length

  const slots = PHASE_ORDER.map((phase) => slotFor(round, phase))

  return (
    <div className="border border-border rounded-md" style={{ padding: '10px 12px' }}>
      <div className="flex items-center justify-between gap-2 flex-wrap" style={{ marginBottom: 8 }}>
        <p className="text-xs font-medium text-text">
          Round {round.index} <span className="text-text-muted">· {round.phase}</span>
        </p>
        {variant === 'pro' && (round.rawIssues.length > 0 || round.triaged.length > 0) && (
          <span className="text-[11px] text-text-muted">
            {round.rawIssues.length} found · {fixCount} fixed · {skipCount} skipped
          </span>
        )}
      </div>

      {round.errorMessage && (
        <p className="text-[11px] text-danger" style={{ marginBottom: 8 }}>
          {round.errorMessage}
        </p>
      )}

      {/* Three live terminal columns. */}
      <div className="flex gap-2" style={{ minHeight: 360 }}>
        {slots.map((slot) => (
          <PhaseColumn
            key={slot.phase}
            slot={slot}
            sessionId={sessionId}
            sessionName={sessionName}
            panelVisible={panelVisible}
          />
        ))}
      </div>

      {variant === 'pro' && round.triaged.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary className="text-[11px] text-text-muted cursor-pointer">
            Triaged issues ({round.triaged.length})
          </summary>
          <div className="flex flex-col gap-1" style={{ marginTop: 6 }}>
            {round.triaged.map((t) => (
              <IssueRow key={t.id} issue={t} />
            ))}
          </div>
        </details>
      )}

      {round.log.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary className="text-[11px] text-text-muted cursor-pointer">Log</summary>
          <pre
            className="text-[11px] text-text-muted whitespace-pre-wrap"
            style={{ marginTop: 4, maxHeight: 160, overflowY: 'auto' }}
          >
            {round.log.join('\n')}
          </pre>
        </details>
      )}
    </div>
  )
}

function slotFor(round: ReviewLoopRound, phase: ReviewLoopPhaseSlot['phase']): ReviewLoopPhaseSlot {
  return (
    round.phaseSlots.find((s) => s.phase === phase) ?? { phase, status: 'pending' }
  )
}

function PhaseColumn({
  slot,
  sessionId,
  sessionName,
  panelVisible,
}: {
  slot: ReviewLoopPhaseSlot
  sessionId: string
  sessionName: string
  panelVisible: boolean
}) {
  const register = useTerminalStore((s) => s.registerDynamicTerminal)

  // Attach the renderer store to the PTY the main process spawned for this
  // phase, so it shows up in terminal listings + keeps its lifecycle metadata.
  useEffect(() => {
    if (slot.terminalId && slot.tabId) {
      register(slot.tabId, slot.terminalId, sessionId, sessionName, 'claude', sessionId)
    }
  }, [slot.terminalId, slot.tabId, sessionId, sessionName, register])

  const frozen =
    slot.status === 'completed' || slot.status === 'error' || slot.status === 'skipped'

  return (
    <div
      className="flex-1 flex flex-col min-w-0 border border-border rounded overflow-hidden bg-bg-tertiary"
      style={{ minWidth: 240 }}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border bg-bg-secondary" style={{ padding: '4px 8px' }}>
        <span className="text-[11px] font-medium text-text">{PHASE_LABEL[slot.phase]}</span>
        <PhasePill status={slot.status} />
      </div>
      <div className="flex-1 relative" style={{ minHeight: 0 }}>
        {slot.terminalId ? (
          <>
            <TerminalView
              terminalId={slot.terminalId}
              sessionId={sessionId}
              sessionName={sessionName}
              visible={panelVisible}
            />
            {frozen && <FrozenOverlay status={slot.status} error={slot.errorMessage} />}
          </>
        ) : slot.transcript ? (
          <HeadlessTranscript
            lines={slot.transcript}
            status={slot.status}
            error={slot.errorMessage}
          />
        ) : (
          <PhasePlaceholder slot={slot} />
        )}
      </div>
    </div>
  )
}

function PhasePlaceholder({ slot }: { slot: ReviewLoopPhaseSlot }) {
  let text = 'Waiting to start…'
  if (slot.status === 'skipped') text = 'Skipped — nothing to do'
  else if (slot.status === 'error') text = slot.errorMessage ?? 'Failed'
  else if (slot.status === 'running') text = 'Starting terminal…'
  else if (slot.status === 'completed') text = '✓ Completed'
  return (
    <div className="absolute inset-0 flex items-center justify-center text-[11px] text-text-muted">
      {text}
    </div>
  )
}

/**
 * Headless phases have no PTY — render the streamed `claude -p` transcript
 * read-only instead of an xterm, auto-scrolling to the tail as lines arrive.
 */
function HeadlessTranscript({
  lines,
  status,
  error,
}: {
  lines: string[]
  status: ReviewLoopPhaseSlot['status']
  error?: string
}) {
  const ref = useRef<HTMLPreElement>(null)
  // Stick to the bottom as new lines stream in.
  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines.length])

  const frozen =
    status === 'completed' || status === 'error' || status === 'skipped'

  return (
    <div className="absolute inset-0 flex flex-col">
      <pre
        ref={ref}
        className="flex-1 text-[11px] leading-[1.4] text-text-muted whitespace-pre-wrap break-words font-mono"
        style={{ margin: 0, padding: '6px 8px', overflowY: 'auto' }}
      >
        {lines.length > 0 ? lines.join('\n') : 'Starting headless phase…'}
      </pre>
      {frozen && <FrozenOverlay status={status} error={error} />}
    </div>
  )
}

/**
 * Read-only overlay drawn over a finished phase terminal. pointer-events stay
 * off so the user can still scroll the scrollback to read it back; the dead PTY
 * means keystrokes are inert anyway.
 */
function FrozenOverlay({
  status,
  error,
}: {
  status: ReviewLoopPhaseSlot['status']
  error?: string
}) {
  let label = '✓ Completed — read-only'
  let cls = 'text-success border-success/40 bg-success/10'
  if (status === 'error') {
    label = `✕ ${error ?? 'Error'}`
    cls = 'text-danger border-danger/40 bg-danger/10'
  } else if (status === 'skipped') {
    label = '— Skipped'
    cls = 'text-warning border-warning/40 bg-warning/10'
  }
  return (
    <div className="absolute inset-0" style={{ pointerEvents: 'none' }}>
      <div
        className={`absolute top-0 left-0 right-0 flex items-center justify-center text-[10px] font-medium uppercase tracking-wide border-b ${cls}`}
        style={{ padding: '2px 6px', backdropFilter: 'blur(0.5px)' }}
      >
        {label}
      </div>
    </div>
  )
}

function PhasePill({ status }: { status: ReviewLoopPhaseSlot['status'] }) {
  let color = 'text-text-muted bg-bg-tertiary'
  if (status === 'running') color = 'text-accent border border-accent/40 bg-accent/10'
  else if (status === 'completed') color = 'text-success border border-success/40 bg-success/10'
  else if (status === 'error') color = 'text-danger border border-danger/40 bg-danger/10'
  else if (status === 'skipped') color = 'text-warning border border-warning/40 bg-warning/10'
  return (
    <span
      className={`inline-flex items-center text-[9px] font-medium rounded uppercase tracking-wide ${color}`}
      style={{ padding: '1px 5px' }}
    >
      {status}
    </span>
  )
}

function IssueRow({ issue }: { issue: ReviewLoopTriagedIssue }) {
  let decisionColor = 'text-text-muted'
  if (issue.decision === 'fix') decisionColor = 'text-success'
  else if (issue.decision === 'skip') decisionColor = 'text-warning'
  else if (issue.decision === 'defer') decisionColor = 'text-accent'

  return (
    <div
      className="border border-border rounded text-xs"
      style={{ padding: '6px 8px' }}
    >
      <div className="flex items-center gap-2">
        <span className={`text-[10px] font-medium uppercase ${decisionColor}`}>
          {issue.decision}
        </span>
        <span className="text-text truncate flex-1">{issue.title}</span>
        {issue.file && (
          <code className="text-[10px] text-text-muted truncate">
            {issue.file}{issue.line ? `:${issue.line}` : ''}
          </code>
        )}
      </div>
      {issue.justification && (
        <p className="text-[11px] text-text-muted" style={{ marginTop: 4 }}>
          {issue.justification}
        </p>
      )}
    </div>
  )
}
