import React from 'react'
import type { Project, ReviewLoopConfig, ReviewLoopProjectOverride } from '../../../shared/types'
import { useReviewLoopStore } from '../../stores/reviewLoopStore'
import { ToggleGroup } from '../ui/ToggleGroup'
import { Button } from '../ui/Button'

interface Props {
  projects: Project[]
}

export function ReviewLoopSettings({ projects }: Props) {
  const settings = useReviewLoopStore((s) => s.settings)
  const setWorkspaceConfig = useReviewLoopStore((s) => s.setWorkspaceConfig)
  const setProjectOverride = useReviewLoopStore((s) => s.setProjectOverride)
  const effectiveConfig = useReviewLoopStore((s) => s.effectiveConfig)

  return (
    <div style={{ marginTop: 40 }}>
      <h1 className="text-lg font-semibold text-text" style={{ marginBottom: 4 }}>
        Review Loop
      </h1>
      <p className="text-xs text-text-muted" style={{ marginBottom: 20 }}>
        Automate the review → triage → fix cycle on a branch. Stop conditions apply to the loop as a whole.
      </p>

      <ConfigCard
        title="Workspace defaults"
        description="Used by every project that hasn't set its own values."
        config={settings.workspace}
        onChange={setWorkspaceConfig}
      />

      {projects.length > 0 && (
        <div className="flex flex-col gap-2" style={{ marginTop: 12 }}>
          {projects.map((project) => {
            const override = settings.projectOverrides[project.id]
            const customized = override != null && Object.keys(override).length > 0
            const config = effectiveConfig(project.id)
            return (
              <ConfigCard
                key={project.id}
                title={project.name}
                description={project.repoPath}
                config={config}
                customized={customized}
                onReset={
                  customized ? () => setProjectOverride(project.id, undefined) : undefined
                }
                onChange={(next) => {
                  // Only persist deltas relative to workspace defaults; an
                  // override of the same value is still fine but we collapse
                  // when nothing differs.
                  const ws = settings.workspace
                  const delta: Partial<ReviewLoopProjectOverride> = {}
                  if (next.enabled !== ws.enabled) delta.enabled = next.enabled
                  if (next.variant !== ws.variant) delta.variant = next.variant
                  if (next.maxIterations !== ws.maxIterations) delta.maxIterations = next.maxIterations
                  if (next.consecutiveCleanRounds !== ws.consecutiveCleanRounds) delta.consecutiveCleanRounds = next.consecutiveCleanRounds
                  if (next.headless !== ws.headless) delta.headless = next.headless
                  setProjectOverride(project.id, Object.keys(delta).length === 0 ? undefined : delta)
                }}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

interface CardProps {
  title: string
  description: string
  config: ReviewLoopConfig
  onChange: (next: ReviewLoopConfig) => void
  customized?: boolean
  onReset?: () => void
}

function ConfigCard({ title, description, config, onChange, customized, onReset }: CardProps) {
  const update = (patch: Partial<ReviewLoopConfig>) =>
    onChange({ ...config, ...patch })

  return (
    <div className="border border-border rounded-md" style={{ padding: '12px 14px' }}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-xs font-medium text-text truncate">{title}</p>
            {customized && (
              <span className="text-[10px] uppercase tracking-wide text-accent border border-accent rounded px-1.5 py-0.5">
                Customized
              </span>
            )}
          </div>
          <p className="text-[10px] text-text-muted truncate">{description}</p>
        </div>
        {onReset && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onReset}
            className="border border-border"
            style={{ padding: '4px 10px' }}
          >
            Reset to default
          </Button>
        )}
      </div>

      <div className="flex items-center justify-between gap-3" style={{ marginTop: 12 }}>
        <div>
          <p className="text-xs text-text">Show review loop button</p>
          <p className="text-[11px] text-text-muted">
            When off, the toolbar button is hidden and the loop won't run for this scope.
          </p>
        </div>
        <ToggleGroup
          options={[
            { value: 'on', label: 'On' },
            { value: 'off', label: 'Off' },
          ]}
          value={config.enabled ? 'on' : 'off'}
          onChange={(v) => update({ enabled: v === 'on' })}
        />
      </div>

      <div className="flex items-center justify-between gap-3" style={{ marginTop: 12 }}>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-text">Variant</p>
          <p className="text-[11px] text-text-muted">
            <strong>Lite</strong> — unstructured: <code>/review</code> → triage table → "do what you think". UI shows raw session output.<br />
            <strong>Pro</strong> — structured 3-phase pipeline with JSON intermediates, issue list, and sticky PR comment.<br />
            <strong>Efficient</strong> — fresh headless reviews (stacked) hand off to one persistent interactive worker that triages + implements every round, keeping context across the loop. Cheaper, and it remembers what it already chose to skip.
          </p>
        </div>
        <ToggleGroup
          className="shrink-0"
          options={[
            { value: 'lite', label: 'Lite' },
            { value: 'pro', label: 'Pro' },
            { value: 'efficient', label: 'Efficient' },
          ]}
          value={config.variant}
          onChange={(v) => update({ variant: v as ReviewLoopConfig['variant'] })}
        />
      </div>

      <div className="flex items-center justify-between gap-3" style={{ marginTop: 12 }}>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-text">Run mode</p>
          <p className="text-[11px] text-text-muted">
            <strong>Headless (-p)</strong> — phases run in the background via <code>claude -p</code> (no terminal); the panel streams each transcript. Avoids the macOS pseudo-terminal limit.<br />
            <strong>Interactive</strong> — each phase opens a live terminal you can watch and type into.
          </p>
        </div>
        {config.variant === 'efficient' ? (
          <span className="shrink-0 text-[11px] text-text-muted border border-border rounded-md" style={{ padding: '4px 12px' }}>
            Fixed: headless reviews + 1 live worker
          </span>
        ) : (
          <ToggleGroup
            className="shrink-0"
            options={[
              { value: 'headless', label: 'Headless (-p)' },
              { value: 'interactive', label: 'Interactive' },
            ]}
            value={config.headless ? 'headless' : 'interactive'}
            onChange={(v) => update({ headless: v === 'headless' })}
          />
        )}
      </div>

      <div
        className="grid grid-cols-3 gap-3"
        style={{ marginTop: 12 }}
      >
        <NumberField
          label="Max iterations"
          hint="Hard cap on rounds."
          value={config.maxIterations}
          min={1}
          max={20}
          onChange={(v) => update({ maxIterations: v })}
        />
        <NumberField
          label="Clean rounds to stop"
          hint="Consecutive empty rounds before exit."
          value={config.consecutiveCleanRounds}
          min={1}
          max={5}
          onChange={(v) => update({ consecutiveCleanRounds: v })}
        />
      </div>
    </div>
  )
}

interface NumberFieldProps {
  label: string
  hint: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
}

function NumberField({ label, hint, value, min, max, step = 1, onChange }: NumberFieldProps) {
  return (
    <label className="flex flex-col">
      <span className="text-[11px] font-medium text-text">{label}</span>
      <input
        type="number"
        className="bg-bg border border-border rounded text-xs text-text focus:outline-none focus:border-accent"
        style={{ padding: '6px 8px', marginTop: 4 }}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const next = Number(e.target.value)
          if (Number.isFinite(next)) onChange(next)
        }}
      />
      <span className="text-[10px] text-text-muted" style={{ marginTop: 2 }}>
        {hint}
      </span>
    </label>
  )
}
