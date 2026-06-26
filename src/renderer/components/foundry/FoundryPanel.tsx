import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { useFoundryStore } from '../../stores/foundryStore'
import { useProjectStore } from '../../stores/projectStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { THEMES } from '../../../shared/themes'
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

// Phase chip colours map onto the app's theme-aware semantic tokens (defined
// per data-theme in globals.css) so they keep good contrast in both light and
// dark. A 1px border gives the pill definition where the tint is faint.
const PHASE_COLOR: Record<FoundryPipelinePhase, string> = {
  'spawn-requested': 'bg-warning/15 text-warning border-warning/40',
  implementing: 'bg-accent/15 text-accent border-accent/40',
  reviewing: 'bg-merged/15 text-merged border-merged/40',
  finalizing: 'bg-success/15 text-success border-success/40',
  done: 'bg-success/15 text-success border-success/40',
  cancelled: 'bg-text-muted/10 text-text-muted border-border',
  orphaned: 'bg-danger/15 text-danger border-danger/40',
}

function isActivePhase(phase: FoundryPipelinePhase): boolean {
  return phase !== 'done' && phase !== 'cancelled' && phase !== 'orphaned'
}

interface FoundryStatusMeta {
  /** Tailwind background class for the status dot. */
  dot: string
  /** Whether the dot should pulse (work in flight). */
  pulse: boolean
  /** Short human label for the status. */
  label: string
  /** Count of in-flight pipelines. */
  activeCount: number
  /** Any pipeline is flagged for attention. */
  attention: boolean
}

function foundryStatusMeta(
  cfg: FoundryConfig,
  state: FoundryRuntimeState | undefined
): FoundryStatusMeta {
  const active = (state?.pipelines ?? []).filter((p) => isActivePhase(p.phase))
  const attention = active.some((p) => p.attention)
  const passInFlight = state?.passInFlight === true
  const activeCount = active.length

  if (!cfg.enabled) {
    return { dot: 'bg-text-muted', pulse: false, label: 'Off', activeCount, attention }
  }
  if (attention) {
    return { dot: 'bg-danger', pulse: true, label: 'Needs attention', activeCount, attention }
  }
  if (cfg.paused) {
    return { dot: 'bg-warning', pulse: false, label: 'Paused', activeCount, attention }
  }
  if (passInFlight) {
    return { dot: 'bg-warning', pulse: true, label: 'Pass running', activeCount, attention }
  }
  if (activeCount > 0) {
    return { dot: 'bg-success', pulse: true, label: 'Running', activeCount, attention }
  }
  return { dot: 'bg-success/50', pulse: false, label: 'Idle', activeCount, attention }
}

export function FoundryPanel() {
  const configs = useFoundryStore((s) => s.configs)
  const states = useFoundryStore((s) => s.states)
  const reload = useFoundryStore((s) => s.reload)
  const projects = useProjectStore((s) => s.projects)
  const currentProjectId = useProjectStore((s) => s.activeProjectId)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    void reload()
  }, [reload])

  const projectFoundries = useMemo(
    () => configs.filter((c) => !currentProjectId || c.projectId === currentProjectId),
    [configs, currentProjectId]
  )

  // Honour the user's manual choice while it still exists; otherwise fall back
  // to the first enabled foundry (or the first one configured). Multiple
  // foundries can run at once — the header dropdown switches between them.
  const selected = useMemo(() => {
    const manual = selectedId && projectFoundries.find((f) => f.id === selectedId)
    if (manual) return manual
    const enabled = projectFoundries.find((f) => f.enabled)
    return enabled ?? projectFoundries[0] ?? null
  }, [projectFoundries, selectedId])

  if (!selected) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-center">
        <div className="max-w-[240px]">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-bg-tertiary text-text-muted">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 20h20" /><path d="m4 20 2.5-9 4 4 3-6 4 5L20 20" />
            </svg>
          </div>
          <p className="text-sm text-text">No foundry configured</p>
          <p className="text-xs text-text-muted mt-1.5 leading-relaxed">
            Add one in <strong className="text-text">Settings → Foundry</strong> to start
            picking up tickets automatically.
          </p>
        </div>
      </div>
    )
  }

  return (
    <FoundryView
      key={selected.id}
      cfg={selected}
      state={states[selected.id]}
      projects={projects}
      foundries={projectFoundries}
      states={states}
      onSelect={setSelectedId}
    />
  )
}

/**
 * Dropdown switcher for when a project runs more than one foundry. The selected
 * foundry's name doubles as the menu trigger; the menu lists every foundry with
 * its live status and in-flight count.
 */
function FoundrySwitcher({
  foundries,
  states,
  selectedId,
  onSelect,
}: {
  foundries: FoundryConfig[]
  states: Record<string, FoundryRuntimeState>
  selectedId: string
  onSelect: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const selected = foundries.find((f) => f.id === selectedId)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="group flex max-w-full items-center gap-2 rounded-lg px-2 py-1 -mx-2 -my-1 hover:bg-bg-tertiary transition-colors"
        title="Switch foundry"
      >
        <span className="text-[15px] font-semibold text-text truncate leading-tight">
          {selected?.name}
        </span>
        <svg
          className={`shrink-0 text-text-muted transition-transform ${open ? 'rotate-180' : ''}`}
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-2 w-[260px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border bg-bg-secondary shadow-xl">
          <div className="px-4 pt-3.5 pb-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            Foundries ({foundries.length})
          </div>
          <div className="pb-1.5">
            {foundries.map((f) => {
              const meta = foundryStatusMeta(f, states[f.id])
              const isSelected = f.id === selectedId
              return (
                <button
                  key={f.id}
                  onClick={() => {
                    onSelect(f.id)
                    setOpen(false)
                  }}
                  className={
                    'flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors ' +
                    (isSelected ? 'bg-accent/10' : 'hover:bg-bg-tertiary')
                  }
                >
                  <span
                    className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${meta.dot} ${
                      meta.pulse ? 'animate-pulse' : ''
                    }`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-text">
                      {f.name}
                    </span>
                    <span className="block text-[11px] text-text-muted">{meta.label}</span>
                  </span>
                  {meta.activeCount > 0 && (
                    <span className="shrink-0 rounded-full bg-bg-tertiary px-2.5 py-1 text-[11px] font-semibold tabular-nums text-text-muted">
                      {meta.activeCount}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function FoundryView({
  cfg,
  state,
  projects,
  foundries,
  states,
  onSelect,
}: {
  cfg: FoundryConfig
  state: FoundryRuntimeState | undefined
  projects: import('../../../shared/types').Project[]
  foundries: FoundryConfig[]
  states: Record<string, FoundryRuntimeState>
  onSelect: (id: string) => void
}) {
  const runNow = useFoundryStore((s) => s.runNow)
  const setPaused = useFoundryStore((s) => s.setPaused)
  const project = projects.find((p) => p.id === cfg.projectId)
  const pipelines = state?.pipelines ?? []
  const activePipelines = pipelines.filter((p) => isActivePhase(p.phase))
  const completedPipelines = pipelines.filter((p) => p.phase === 'done')
  const passes = state?.passes ?? []
  const latestPass = passes[passes.length - 1]
  const passInFlight = state?.passInFlight === true
  const status = foundryStatusMeta(cfg, state)

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Header */}
      <div className="px-6 py-5 border-b border-border">
        <div className="min-w-0">
          {foundries.length > 1 ? (
            <FoundrySwitcher
              foundries={foundries}
              states={states}
              selectedId={cfg.id}
              onSelect={onSelect}
            />
          ) : (
            <div className="text-[15px] font-semibold text-text truncate leading-tight">
              {cfg.name}
            </div>
          )}
          <div className="mt-2 flex items-center gap-2 text-xs text-text-muted">
            <span
              className={`inline-block h-2 w-2 shrink-0 rounded-full ${status.dot} ${
                status.pulse ? 'animate-pulse' : ''
              }`}
            />
            <span className="text-text">{status.label}</span>
            <span className="text-text-muted/60">·</span>
            <span className="truncate">{project?.name ?? cfg.projectId}</span>
          </div>
        </div>

        {cfg.enabled && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" onClick={() => void runNow(cfg.id)}>
              Run pass
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="border border-border"
              onClick={() => void setPaused(cfg.id, !cfg.paused)}
            >
              {cfg.paused ? 'Resume' : 'Pause'}
            </Button>
            {cfg.localPrMode && (
              <Button
                size="sm"
                variant="ghost"
                className="border border-border"
                disabled={state?.publish?.status === 'running'}
                onClick={() => void window.api.foundry.publishPRs(cfg.id)}
                title="Promote this run's local PRs to real GitHub PRs, in order"
              >
                {state?.publish?.status === 'running' ? 'Creating PRs…' : 'Create PRs'}
              </Button>
            )}
            <span className="ml-auto text-[11px] text-text-muted">
              max {cfg.maxConcurrentTasks}
            </span>
          </div>
        )}
      </div>

      {/* Off state */}
      {!cfg.enabled && (
        <div className="flex-1 flex items-center justify-center p-8 text-center">
          <div className="max-w-[240px]">
            <p className="text-sm text-text">Foundry is off</p>
            <p className="text-xs text-text-muted mt-1.5 leading-relaxed">
              Turn it on from <strong className="text-text">Settings → Foundry</strong> to
              start picking up tickets.
            </p>
          </div>
        </div>
      )}

      {/* On state */}
      {cfg.enabled && (
        <div className="flex-1 min-h-0 flex flex-col">
          {/* Top half: status + pipelines */}
          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6 space-y-7">
            {state?.lastError && (
              <div className="rounded-lg px-4 py-3.5 text-xs leading-relaxed text-danger bg-danger/10 border border-danger/30">
                {state.lastError}
              </div>
            )}

            {/* Foreman pass status */}
            <section>
              <SectionLabel>Foreman</SectionLabel>
              <div className="mt-3.5 rounded-lg border border-border bg-bg-tertiary/40 px-4 py-4">
                {passInFlight ? (
                  <div className="flex items-center gap-2 text-sm text-text">
                    <span className="inline-block h-2 w-2 rounded-full bg-warning animate-pulse" />
                    Pass running…
                  </div>
                ) : latestPass ? (
                  <div className="text-xs text-text-muted leading-relaxed">
                    Last pass <span className="text-text font-medium">#{latestPass.index}</span>{' '}
                    · {latestPass.status} · {latestPass.trigger} · started{' '}
                    {latestPass.startedPageIds.length} task(s)
                    {latestPass.errorMessage ? ` · ${latestPass.errorMessage}` : ''}
                  </div>
                ) : (
                  <div className="text-xs text-text-muted">No passes yet.</div>
                )}
              </div>
            </section>

            {/* Active pipelines */}
            <section>
              <SectionLabel>Active ({activePipelines.length})</SectionLabel>
              {activePipelines.length === 0 ? (
                <div className="mt-3 rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-text-muted italic">
                  {passInFlight
                    ? 'Foreman is deciding what to start…'
                    : 'No pipelines running.'}
                </div>
              ) : (
                <div className="mt-3.5 space-y-4">
                  {activePipelines.map((p) => (
                    <PipelineRow key={p.id} foundryId={cfg.id} pipeline={p} />
                  ))}
                </div>
              )}
            </section>

            {/* Completed */}
            {completedPipelines.length > 0 && (
              <details className="rounded-lg border border-border bg-bg-tertiary/30 px-4 py-3.5" open={false}>
                <summary className="cursor-pointer select-none">
                  <SectionLabel inline>Completed ({completedPipelines.length})</SectionLabel>
                </summary>
                <div className="space-y-4 mt-3.5">
                  {completedPipelines.slice(-10).reverse().map((p) => (
                    <PipelineRow key={p.id} foundryId={cfg.id} pipeline={p} />
                  ))}
                </div>
              </details>
            )}

            {/* Pass history */}
            {passes.length > 1 && (
              <details className="rounded-lg border border-border bg-bg-tertiary/30 px-4 py-3.5">
                <summary className="cursor-pointer select-none">
                  <SectionLabel inline>Pass history ({passes.length})</SectionLabel>
                </summary>
                <div className="mt-3 space-y-2">
                  {[...passes].slice(-10).reverse().map((pass, i) => (
                    <div
                      key={`${pass.index}-${pass.startedAt}-${i}`}
                      className="text-xs text-text-muted leading-relaxed"
                    >
                      <span className="text-text font-medium">#{pass.index}</span> ·{' '}
                      {pass.status} · {pass.trigger} · started{' '}
                      {pass.startedPageIds.length} task(s)
                      {pass.errorMessage ? ` · ${pass.errorMessage}` : ''}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>

          {/* Bottom half: live foreman PTY while a pass is running, otherwise
              the latest pass transcript (read-only). */}
          {state?.foremanTerminalId ? (
            <ForemanPtyPane terminalId={state.foremanTerminalId} />
          ) : (
            <ForemanTranscriptPane state={state} />
          )}
        </div>
      )}
    </div>
  )
}

function SectionLabel({
  children,
  inline = false,
}: {
  children: ReactNode
  inline?: boolean
}) {
  return (
    <span
      className={
        (inline ? 'inline-block ' : 'block ') +
        'text-[11px] font-semibold uppercase tracking-wider text-text-muted'
      }
    >
      {children}
    </span>
  )
}

function ForemanPtyPane({ terminalId }: { terminalId: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const theme = useSettingsStore((s) => s.theme)

  useEffect(() => {
    if (!containerRef.current) return
    const terminalTheme =
      THEMES.find((t) => t.name === theme)?.terminal ?? THEMES[0].terminal
    const term = new Terminal({
      theme: terminalTheme,
      fontSize: 11,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      cursorBlink: true,
      scrollback: 20000,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(containerRef.current)
    requestAnimationFrame(() => fit.fit())

    term.onData((data) => {
      void window.api.terminal.write(terminalId, data)
    })
    const offData = window.api.terminal.onData((tid, data) => {
      if (tid === terminalId) term.write(data)
    })
    // Don't attempt to write on exit — leave any final claude output as the
    // last thing on screen. State will swap us back to the transcript view.
    const offExit = window.api.terminal.onExit(() => {})

    termRef.current = term
    fitRef.current = fit

    const onResize = () => fit.fit()
    window.addEventListener('resize', onResize)

    return () => {
      offData()
      offExit()
      window.removeEventListener('resize', onResize)
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [terminalId, theme])

  return (
    <div
      className="border-t border-border flex flex-col shrink-0"
      style={{ height: 320 }}
    >
      <div className="px-6 py-3 flex items-center justify-between border-b border-border">
        <SectionLabel inline>
          Foreman <span className="font-normal normal-case tracking-normal">— interactive</span>
        </SectionLabel>
        <span className="text-[11px] text-warning flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-warning animate-pulse" />
          live
        </span>
      </div>
      <div ref={containerRef} className="flex-1 min-h-0" style={{ padding: "8px 10px" }} />
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
      <div className="px-6 py-3 flex items-center justify-between border-b border-border">
        <SectionLabel inline>
          Foreman transcript
          {latestPass && (
            <span className="ml-2 font-normal normal-case tracking-normal text-text-muted">
              · pass #{latestPass.index} {latestPass.trigger}
            </span>
          )}
        </SectionLabel>
        {inFlight && (
          <span className="text-[11px] text-warning flex items-center gap-1.5">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-warning animate-pulse" />
            streaming
          </span>
        )}
      </div>
      {transcriptText ? (
        <pre
          ref={scrollRef}
          onScroll={onScroll}
          className="flex-1 min-h-0 overflow-y-auto text-[11px] leading-relaxed text-text whitespace-pre-wrap break-words"
          style={{
            padding: '12px 22px',
            fontFamily: 'Menlo, Monaco, "Courier New", monospace',
          }}
        >
          {transcriptText}
        </pre>
      ) : (
        <div className="flex-1 p-4 text-xs text-text-muted italic">
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
  const chipClass = PHASE_COLOR[phase] ?? 'bg-text-muted/10 text-text-muted border-border'
  const actions = useMemo(() => {
    if (phase === 'done' || phase === 'cancelled' || phase === 'orphaned') return [] as const
    const list: Array<'cancel' | 'resume' | 'retry-phase' | 'skip-phase'> = []
    if (pipeline.attention) list.push('resume', 'retry-phase', 'skip-phase')
    else list.push('retry-phase')
    list.push('cancel')
    return list
  }, [phase, pipeline.attention])
  return (
    <div className="rounded-lg border border-border bg-bg-secondary/40 overflow-hidden">
      <button
        className="w-full flex items-start gap-2.5 px-4 py-4 text-left hover:bg-bg-tertiary transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="min-w-0 flex-1">
          <div className="text-[13px] text-text truncate" title={pipeline.page.title}>
            {pipeline.page.title || pipeline.page.id}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <span
              className={`inline-block text-[10px] px-3 py-1.5 rounded-full border font-semibold uppercase tracking-wide ${chipClass}`}
            >
              {PHASE_LABEL[phase]}
            </span>
            {pipeline.prUrl && (
              <span className="text-xs text-text-muted">PR #{pipeline.prNumber}</span>
            )}
          </div>
          {pipeline.attention && (
            <div className="mt-1.5 text-xs text-warning leading-relaxed">
              ⚠ {pipeline.attention.reason}
            </div>
          )}
        </div>
        <svg
          className={`mt-0.5 shrink-0 text-text-muted transition-transform ${expanded ? 'rotate-90' : ''}`}
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
      {expanded && (
        <div className="border-t border-border p-3 space-y-2.5">
          {pipeline.prUrl && (
            <div className="text-xs">
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
            <summary className="text-xs text-text-muted cursor-pointer select-none">
              Log ({pipeline.log.length})
            </summary>
            <pre className="mt-1.5 text-[11px] leading-relaxed text-text-muted whitespace-pre-wrap max-h-40 overflow-y-auto">
              {pipeline.log.join('\n')}
            </pre>
          </details>
          {actions.length > 0 && (
            <div className="flex gap-1.5 flex-wrap">
              {actions.map((a) => (
                <Button
                  key={a}
                  size="sm"
                  variant="ghost"
                  className="border border-border"
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
