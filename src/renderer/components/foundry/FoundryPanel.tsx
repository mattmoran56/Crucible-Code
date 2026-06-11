import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useFoundryStore } from '../../stores/foundryStore'
import { useProjectStore } from '../../stores/projectStore'
import { Button } from '../ui/Button'
import type {
  FoundryConfig,
  FoundryPipeline,
  FoundryPipelinePhase,
  FoundryRuntimeState,
} from '../../../shared/types'

const PHASE_LABEL: Record<FoundryPipelinePhase, string> = {
  'spawn-requested': 'Spawning',
  implementing: 'Implementing',
  reviewing: 'Reviewing',
  finalizing: 'Finalizing',
  done: 'Done',
  cancelled: 'Cancelled',
  orphaned: 'Orphaned',
}

const PHASE_COLOR: Record<FoundryPipelinePhase, string> = {
  'spawn-requested': 'bg-amber-500/20 text-amber-300',
  implementing: 'bg-blue-500/20 text-blue-300',
  reviewing: 'bg-violet-500/20 text-violet-300',
  finalizing: 'bg-emerald-500/20 text-emerald-300',
  done: 'bg-emerald-500/20 text-emerald-300',
  cancelled: 'bg-zinc-500/20 text-zinc-400',
  orphaned: 'bg-rose-500/20 text-rose-300',
}

export function FoundryPanel() {
  const configs = useFoundryStore((s) => s.configs)
  const states = useFoundryStore((s) => s.states)
  const reload = useFoundryStore((s) => s.reload)
  const projects = useProjectStore((s) => s.projects)
  const currentProjectId = useProjectStore((s) => s.activeProjectId)

  useEffect(() => {
    void reload()
  }, [reload])

  const projectFoundries = useMemo(
    () => configs.filter((c) => !currentProjectId || c.projectId === currentProjectId),
    [configs, currentProjectId]
  )

  // The most recent enabled foundry (or the most recent in general if none are
  // enabled) is "selected" — its pipelines fill the top and its foreman
  // terminal is pinned to the bottom. With one foundry per project this is
  // typically just "the foundry".
  const selected = useMemo(() => {
    const enabled = projectFoundries.find((f) => f.enabled)
    return enabled ?? projectFoundries[0] ?? null
  }, [projectFoundries])

  if (!selected) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-center">
        <div>
          <p className="text-sm text-text-muted">No foundry configured for this project.</p>
          <p className="text-[11px] text-text-muted mt-2">
            Add one in <strong>Settings → Foundry</strong>.
          </p>
        </div>
      </div>
    )
  }

  return <FoundryView cfg={selected} state={states[selected.id]} projects={projects} />
}

function FoundryView({
  cfg,
  state,
  projects,
}: {
  cfg: FoundryConfig
  state: import('../../../shared/types').FoundryRuntimeState | undefined
  projects: import('../../../shared/types').Project[]
}) {
  const runNow = useFoundryStore((s) => s.runNow)
  const setPaused = useFoundryStore((s) => s.setPaused)
  const project = projects.find((p) => p.id === cfg.projectId)
  const pipelines = state?.pipelines ?? []
  const activePipelines = pipelines.filter(
    (p) => p.phase !== 'done' && p.phase !== 'cancelled' && p.phase !== 'orphaned'
  )
  const completedPipelines = pipelines.filter((p) => p.phase === 'done')
  const passes = state?.passes ?? []
  const latestPass = passes[passes.length - 1]
  const passInFlight = state?.passInFlight === true

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-text truncate">{cfg.name}</div>
          <div className="text-[11px] text-text-muted truncate">
            {project?.name ?? cfg.projectId}
            {' · '}
            {cfg.enabled ? (cfg.paused ? 'paused' : 'running') : 'off'}
            {' · '}
            max {cfg.maxConcurrentTasks}
          </div>
        </div>
        <div className="flex gap-1 shrink-0">
          {cfg.enabled && (
            <Button size="sm" variant="ghost" onClick={() => void runNow(cfg.id)}>
              Run pass
            </Button>
          )}
          {cfg.enabled && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void setPaused(cfg.id, !cfg.paused)}
            >
              {cfg.paused ? 'Resume' : 'Pause'}
            </Button>
          )}
        </div>
      </div>

      {/* Off state */}
      {!cfg.enabled && (
        <div className="flex-1 flex items-center justify-center p-6 text-center">
          <div>
            <p className="text-sm text-text-muted">Foundry is off.</p>
            <p className="text-[11px] text-text-muted mt-2">
              Turn it on from <strong>Settings → Foundry</strong> to start picking up
              tickets.
            </p>
          </div>
        </div>
      )}

      {/* On state */}
      {cfg.enabled && (
        <div className="flex-1 min-h-0 flex flex-col">
          {/* Top half: status + pipelines */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {state?.lastError && (
              <div className="px-3 py-2 text-[11px] text-rose-300 bg-rose-500/10 border-b border-border">
                {state.lastError}
              </div>
            )}

            {/* Foreman pass status */}
            <div className="px-3 py-2 border-b border-border">
              <div className="text-[11px] uppercase tracking-wide text-text-muted">
                Foreman
              </div>
              {passInFlight ? (
                <div className="mt-1 text-xs text-text flex items-center gap-2">
                  <span className="inline-block h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                  Pass running…
                </div>
              ) : latestPass ? (
                <div className="mt-1 text-xs text-text-muted">
                  Last pass: #{latestPass.index} · {latestPass.status} ·{' '}
                  {latestPass.trigger} · started {latestPass.startedPageIds.length} task(s)
                  {latestPass.errorMessage ? ` · ${latestPass.errorMessage}` : ''}
                </div>
              ) : (
                <div className="mt-1 text-xs text-text-muted">No passes yet.</div>
              )}
            </div>

            {/* Active pipelines */}
            <div className="px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-text-muted mb-1">
                Active ({activePipelines.length})
              </div>
              {activePipelines.length === 0 ? (
                <div className="text-xs text-text-muted italic py-2">
                  {passInFlight
                    ? 'Foreman is deciding what to start…'
                    : 'No pipelines running.'}
                </div>
              ) : (
                <div className="space-y-1">
                  {activePipelines.map((p) => (
                    <PipelineRow key={p.id} foundryId={cfg.id} pipeline={p} />
                  ))}
                </div>
              )}
            </div>

            {/* Completed */}
            {completedPipelines.length > 0 && (
              <details className="px-3 py-2 border-t border-border" open={false}>
                <summary className="text-[11px] uppercase tracking-wide text-text-muted cursor-pointer select-none">
                  Completed ({completedPipelines.length})
                </summary>
                <div className="space-y-1 mt-2">
                  {completedPipelines.slice(-10).reverse().map((p) => (
                    <PipelineRow key={p.id} foundryId={cfg.id} pipeline={p} />
                  ))}
                </div>
              </details>
            )}

            {/* Pass history */}
            {passes.length > 1 && (
              <details className="px-3 py-2 border-t border-border">
                <summary className="text-[11px] uppercase tracking-wide text-text-muted cursor-pointer select-none">
                  Pass history ({passes.length})
                </summary>
                <div className="mt-2 space-y-1">
                  {[...passes].slice(-10).reverse().map((pass) => (
                    <div key={pass.index} className="text-[11px] text-text-muted">
                      #{pass.index} · {pass.status} · {pass.trigger} · started{' '}
                      {pass.startedPageIds.length} task(s)
                      {pass.errorMessage ? ` · ${pass.errorMessage}` : ''}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>

          {/* Bottom half: pinned foreman transcript */}
          <ForemanTranscriptPane state={state} />
        </div>
      )}
    </div>
  )
}

function ForemanTranscriptPane({ state }: { state: FoundryRuntimeState | undefined }) {
  const passes = state?.passes ?? []
  const latestPass = passes[passes.length - 1]
  const transcript = latestPass?.transcript ?? []
  const transcriptText = transcript.join('\n')
  const inFlight = state?.passInFlight === true && latestPass?.status === 'running'
  const scrollRef = useRef<HTMLPreElement>(null)
  const stickToBottomRef = useRef(true)

  // Stick to bottom while new lines stream in — but only if the user hasn't
  // scrolled away. Detect "near bottom" with a small slack so a one-line
  // overshoot still counts as stuck.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || !stickToBottomRef.current) return
    el.scrollTop = el.scrollHeight
  }, [transcriptText, inFlight])

  const onScroll = (): void => {
    const el = scrollRef.current
    if (!el) return
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32
  }

  return (
    <div
      className="border-t border-border flex flex-col shrink-0"
      style={{ height: 320 }}
    >
      <div className="px-3 py-1.5 flex items-center justify-between border-b border-border">
        <div className="text-[11px] uppercase tracking-wide text-text-muted">
          Foreman transcript
          {latestPass && (
            <span className="ml-2 text-text-muted normal-case">
              · pass #{latestPass.index} {latestPass.trigger}
            </span>
          )}
        </div>
        {inFlight && (
          <span className="text-[11px] text-amber-300 flex items-center gap-1.5">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
            streaming
          </span>
        )}
      </div>
      {transcriptText ? (
        <pre
          ref={scrollRef}
          onScroll={onScroll}
          className="flex-1 min-h-0 overflow-y-auto text-[10.5px] leading-tight text-text whitespace-pre-wrap break-words"
          style={{
            padding: '8px 10px',
            fontFamily: 'Menlo, Monaco, "Courier New", monospace',
          }}
        >
          {transcriptText}
        </pre>
      ) : (
        <div className="flex-1 p-3 text-[11px] text-text-muted italic">
          {inFlight
            ? 'Foreman starting…'
            : 'No pass yet. Hit "Run pass" to kick the foreman.'}
        </div>
      )}
    </div>
  )
}

function PipelineRow({
  foundryId,
  pipeline,
}: {
  foundryId: string
  pipeline: FoundryPipeline
}) {
  const [expanded, setExpanded] = useState(false)
  const phase = pipeline.phase
  const chipClass = PHASE_COLOR[phase] ?? 'bg-zinc-500/20 text-zinc-300'
  const actions = useMemo(() => {
    if (phase === 'done' || phase === 'cancelled' || phase === 'orphaned') return [] as const
    const list: Array<'cancel' | 'resume' | 'retry-phase' | 'skip-phase'> = []
    if (pipeline.attention) list.push('resume', 'retry-phase', 'skip-phase')
    else list.push('retry-phase')
    list.push('cancel')
    return list
  }, [phase, pipeline.attention])
  return (
    <div className="text-xs border border-border rounded">
      <button
        className="w-full flex items-center justify-between gap-2 px-2 py-1.5 hover:bg-bg-tertiary"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="min-w-0 text-left">
          <div className="text-text truncate" title={pipeline.page.title}>
            {pipeline.page.title || pipeline.page.id}
          </div>
          {pipeline.attention && (
            <div className="text-[11px] text-amber-300 truncate">
              ⚠ {pipeline.attention.reason}
            </div>
          )}
          {pipeline.prUrl && !pipeline.attention && (
            <div className="text-[11px] text-text-muted truncate">PR #{pipeline.prNumber}</div>
          )}
        </div>
        <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide ${chipClass}`}>
          {PHASE_LABEL[phase]}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-border p-2 space-y-2">
          {pipeline.prUrl && (
            <div className="text-[11px]">
              PR:{' '}
              <a
                className="text-accent underline"
                href={pipeline.prUrl}
                target="_blank"
                rel="noreferrer"
              >
                #{pipeline.prNumber}
              </a>
            </div>
          )}
          <details>
            <summary className="text-[11px] text-text-muted cursor-pointer select-none">
              Log ({pipeline.log.length})
            </summary>
            <pre className="mt-1 text-[10px] text-text-muted whitespace-pre-wrap max-h-40 overflow-y-auto">
              {pipeline.log.join('\n')}
            </pre>
          </details>
          {actions.length > 0 && (
            <div className="flex gap-1 flex-wrap">
              {actions.map((a) => (
                <Button
                  key={a}
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void window.api.foundry.pipelineAction(foundryId, pipeline.id, a)
                  }
                >
                  {a.replace('-', ' ')}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

