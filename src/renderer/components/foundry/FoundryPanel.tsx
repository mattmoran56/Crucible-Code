import { useEffect, useMemo, useState } from 'react'
import { useFoundryStore } from '../../stores/foundryStore'
import { useProjectStore } from '../../stores/projectStore'
import { Button } from '../ui/Button'
import type { FoundryPipeline, FoundryPipelinePhase } from '../../../shared/types'

const PHASE_LABEL: Record<FoundryPipelinePhase, string> = {
  'spawn-requested': 'Spawning',
  implementing: 'Implementing',
  pushing: 'Pushing',
  'creating-pr': 'Creating PR',
  reviewing: 'Reviewing',
  finalizing: 'Finalizing',
  done: 'Done',
  cancelled: 'Cancelled',
  orphaned: 'Orphaned',
}

const PHASE_COLOR: Record<FoundryPipelinePhase, string> = {
  'spawn-requested': 'bg-amber-500/20 text-amber-300',
  implementing: 'bg-blue-500/20 text-blue-300',
  pushing: 'bg-blue-500/20 text-blue-300',
  'creating-pr': 'bg-violet-500/20 text-violet-300',
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
  const setPaused = useFoundryStore((s) => s.setPaused)
  const runNow = useFoundryStore((s) => s.runNow)
  const projects = useProjectStore((s) => s.projects)
  const currentProjectId = useProjectStore((s) => s.activeProjectId)

  useEffect(() => {
    void reload()
  }, [reload])

  const projectFoundries = useMemo(
    () => configs.filter((c) => !currentProjectId || c.projectId === currentProjectId),
    [configs, currentProjectId]
  )

  if (projectFoundries.length === 0) {
    return (
      <div className="p-4 text-sm text-text-muted">
        No foundries configured for this project.{' '}
        <span className="block mt-2 text-xs">
          Configure one in <strong>Settings → Foundry</strong>.
        </span>
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      {projectFoundries.map((cfg) => {
        const project = projects.find((p) => p.id === cfg.projectId)
        const state = states[cfg.id]
        return (
          <div key={cfg.id} className="border-b border-border">
            <div className="px-3 py-2 flex items-center justify-between bg-bg-tertiary">
              <div className="min-w-0">
                <div className="text-sm font-medium text-text truncate">{cfg.name}</div>
                <div className="text-[11px] text-text-muted truncate">
                  {project?.name ?? cfg.projectId}
                  {cfg.paused ? ' · paused' : cfg.enabled ? ' · enabled' : ' · disabled'}
                </div>
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => void runNow(cfg.id)}>
                  Run now
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void setPaused(cfg.id, !cfg.paused)}
                >
                  {cfg.paused ? 'Resume' : 'Pause'}
                </Button>
              </div>
            </div>
            {state?.lastError && (
              <div className="px-3 py-1 text-[11px] text-rose-300 bg-rose-500/10">{state.lastError}</div>
            )}
            <div className="px-3 py-2 space-y-1">
              {(state?.pipelines ?? []).length === 0 && (
                <div className="text-xs text-text-muted">No pipelines yet.</div>
              )}
              {(state?.pipelines ?? []).map((p) => (
                <PipelineRow key={p.id} foundryId={cfg.id} pipeline={p} />
              ))}
            </div>
            {state?.passes && state.passes.length > 0 && (
              <details className="px-3 pb-2">
                <summary className="text-[11px] text-text-muted cursor-pointer select-none">
                  Foreman passes ({state.passes.length})
                </summary>
                <div className="mt-2 space-y-1">
                  {[...state.passes].slice(-5).reverse().map((pass) => (
                    <div key={pass.index} className="text-[11px] text-text-muted">
                      #{pass.index} · {pass.status} · {pass.trigger} · started {pass.startedPageIds.length} task(s)
                      {pass.errorMessage ? ` · ${pass.errorMessage}` : ''}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )
      })}
    </div>
  )
}

interface PipelineRowProps {
  foundryId: string
  pipeline: FoundryPipeline
}

function PipelineRow({ foundryId, pipeline }: PipelineRowProps) {
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
        className="w-full flex items-center justify-between gap-2 px-2 py-1 hover:bg-bg-tertiary"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="min-w-0 text-left">
          <div className="text-text truncate" title={pipeline.page.title}>
            {pipeline.page.title || pipeline.page.id}
          </div>
          {pipeline.attention && (
            <div className="text-[11px] text-amber-300 truncate">⚠ {pipeline.attention.reason}</div>
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
              <a className="text-accent underline" href={pipeline.prUrl} target="_blank" rel="noreferrer">
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
