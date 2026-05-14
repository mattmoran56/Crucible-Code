import React, { useEffect, useMemo, useRef } from 'react'
import { useReviewLoopStore } from '../../stores/reviewLoopStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useProjectStore } from '../../stores/projectStore'
import { usePRStore } from '../../stores/prStore'
import { Button } from '../ui/Button'
import type {
  ReviewLoopRound,
  ReviewLoopState,
  ReviewLoopStopReason,
  ReviewLoopTriagedIssue,
} from '../../../shared/types'

interface Props {
  visible?: boolean
}

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
            {' · '}max {config.maxIterations} rounds · stop after {config.consecutiveCleanRounds} clean · ${config.costCapUsd.toFixed(2)} cap
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
        {state ? <LoopStateView state={state} /> : <EmptyState variant={config.variant} />}
      </div>
    </div>
  )
}

function EmptyState({ variant }: { variant: 'lite' | 'pro' }) {
  if (variant === 'lite') {
    return (
      <div className="text-xs text-text-muted">
        <p>Press <strong>Start review loop</strong> to begin. Each round runs:</p>
        <ol style={{ marginTop: 8, paddingLeft: 18 }}>
          <li><strong>Review</strong> — <code>/review</code> on the PR (or the diff vs. base).</li>
          <li><strong>Triage</strong> — sub-agents investigate each issue and propose a decision as a table.</li>
          <li><strong>Fix</strong> — same session as triage: "do what you think needs doing, commit, and push".</li>
        </ol>
        <p style={{ marginTop: 12 }}>
          The UI shows the raw session output. Stops after consecutive rounds with no new commit, the iteration cap, the cost cap, or manual cancel.
        </p>
      </div>
    )
  }
  return (
    <div className="text-xs text-text-muted">
      <p>Press <strong>Start review loop</strong> to begin. Each round runs three phases:</p>
      <ol style={{ marginTop: 8, paddingLeft: 18 }}>
        <li><strong>Review</strong> — Claude reviews the diff vs. base and writes findings.</li>
        <li><strong>Triage</strong> — A sub-agent investigates each finding and decides fix / skip / defer.</li>
        <li><strong>Fix</strong> — Claude applies fixes, commits, and pushes.</li>
      </ol>
      <p style={{ marginTop: 12 }}>
        The loop stops after consecutive clean rounds, the iteration cap, the cost cap, or manual cancel.
        Skipped or deferred items get summarised in a sticky comment on the PR.
      </p>
    </div>
  )
}

function LoopStateView({ state }: { state: ReviewLoopState }) {
  const reversed = [...state.rounds].reverse()
  const latestIndex = reversed[0]?.index
  const variant = state.variant ?? 'pro'
  return (
    <div className="flex flex-col gap-3">
      <SummaryBar state={state} />
      {state.rounds.length === 0 && state.status === 'running' && (
        <p className="text-xs text-text-muted">Starting first round…</p>
      )}
      {reversed.map((round) => (
        <RoundCard
          key={round.index}
          round={round}
          variant={variant}
          isLatest={round.index === latestIndex}
          loopRunning={state.status === 'running'}
        />
      ))}
    </div>
  )
}

function SummaryBar({ state }: { state: ReviewLoopState }) {
  const status = state.status
  const phase = state.currentPhase
  const variant = state.variant ?? 'pro'

  const fixedTotal = useMemo(
    () =>
      state.rounds.reduce(
        (acc, r) => acc + r.triaged.filter((t) => t.decision === 'fix').length,
        0
      ),
    [state.rounds]
  )

  return (
    <div className="border border-border rounded-md" style={{ padding: '10px 12px' }}>
      <div className="flex items-center gap-3 flex-wrap">
        <StatusPill status={status} phase={phase} />
        <span className="text-[10px] uppercase tracking-wide text-text-muted border border-border rounded px-1.5">
          {variant}
        </span>
        <span className="text-[11px] text-text-muted">
          Round {state.iteration} · ${state.cumulativeCostUsd.toFixed(3)} spent{variant === 'pro' ? ` · ${fixedTotal} ${fixedTotal === 1 ? 'fix' : 'fixes'} so far` : ''}
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
    case 'costCap': return 'cost cap reached'
    case 'cancelled': return 'cancelled'
    case 'error': return 'error'
  }
}

function RoundCard({
  round,
  variant,
  isLatest,
  loopRunning,
}: {
  round: ReviewLoopRound
  variant: 'lite' | 'pro'
  isLatest: boolean
  loopRunning: boolean
}) {
  const fixCount = round.triaged.filter((t) => t.decision === 'fix').length
  const skipCount = round.triaged.filter(
    (t) => t.decision === 'skip' || t.decision === 'defer'
  ).length
  const transcript = round.transcript ?? []
  const isActiveRound = isLatest && loopRunning

  return (
    <div className="border border-border rounded-md" style={{ padding: '10px 12px' }}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs font-medium text-text">
          Round {round.index} <span className="text-text-muted">· {round.phase}</span>
        </p>
        <span className="text-[11px] text-text-muted">
          {variant === 'pro'
            ? `${round.rawIssues.length} found · ${fixCount} fixed · ${skipCount} skipped · $${round.costUsd.toFixed(3)}`
            : `$${round.costUsd.toFixed(3)}`}
        </span>
      </div>

      {round.errorMessage && (
        <p className="text-[11px] text-danger" style={{ marginTop: 4 }}>
          {round.errorMessage}
        </p>
      )}

      {variant === 'pro' && round.triaged.length > 0 && (
        <div className="flex flex-col gap-1" style={{ marginTop: 8 }}>
          {round.triaged.map((t) => (
            <IssueRow key={t.id} issue={t} />
          ))}
        </div>
      )}

      {transcript.length > 0 && (
        <LiveTranscript
          lines={transcript}
          defaultOpen={isActiveRound}
          autoScroll={isActiveRound}
          label={isActiveRound ? `Live output (${transcript.length})` : `Output (${transcript.length})`}
        />
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

function LiveTranscript({
  lines,
  defaultOpen,
  autoScroll,
  label,
}: {
  lines: string[]
  defaultOpen: boolean
  autoScroll: boolean
  label: string
}) {
  const preRef = useRef<HTMLPreElement | null>(null)

  useEffect(() => {
    if (!autoScroll) return
    const el = preRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [lines, autoScroll])

  return (
    <details open={defaultOpen} style={{ marginTop: 8 }}>
      <summary className="text-[11px] text-text-muted cursor-pointer">{label}</summary>
      <pre
        ref={preRef}
        className="text-[11px] text-text whitespace-pre-wrap font-mono bg-bg-tertiary rounded"
        style={{ marginTop: 4, maxHeight: 280, overflowY: 'auto', padding: '6px 8px' }}
      >
        {lines.join('\n')}
      </pre>
    </details>
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
