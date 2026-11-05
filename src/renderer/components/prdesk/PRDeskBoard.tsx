import React, { useMemo } from 'react'
import {
  DESK_RULES,
  DESK_STAGES,
  deskStageOf,
  involvesMe,
  parkedReason,
  ticketKey,
  type DeskPR,
  type DeskProject,
  type DeskStage,
  type DeskTicket,
} from '../../../shared/prDesk'
import { CIIndicator } from '../pullrequests/CIIndicator'
import { PRLabelChip } from '../pullrequests/PRLabelChip'
import { Avatar } from '../ui/Avatar'
import type { PRDeskScope, PRDeskView } from '../../stores/prDeskStore'

export interface PRDeskBoardProps {
  prs: DeskPR[]
  tickets: Record<string, DeskTicket>
  /** Notion projects by id: the expanded view has a row per project. */
  projects?: Record<string, DeskProject>
  parked: number[]
  me: string | null
  view: PRDeskView
  scope: PRDeskScope
  activePRNumber: number | null
  attention?: (prNumber: number) => boolean
  onOpen: (pr: DeskPR) => void
  onOpenExternal: (url: string) => void
  onTogglePark: (prNumber: number) => void
}

interface PlacedPR {
  pr: DeskPR
  ticket: DeskTicket | null
  stage: DeskStage
  parkedWhy: string | null
}

const HIDDEN_LABELS = new Set([DESK_RULES.humanRequiredLabel, DESK_RULES.autoOkLabel])

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const minutes = Math.max(0, Math.floor((Date.now() - then) / 60_000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

/** Places each PR in its stage, applying the Mine/All scope. Exported for tests. */
export function placePRs(
  prs: DeskPR[],
  opts: { tickets: Record<string, DeskTicket>; parked: number[]; me: string | null; scope: PRDeskScope }
): Record<DeskStage, PlacedPR[]> {
  const parked = new Set(opts.parked)
  const out: Record<DeskStage, PlacedPR[]> = { draft: [], pending: [], ready: [], assigned: [], parked: [] }
  for (const pr of prs) {
    if (opts.scope === 'mine' && !involvesMe(pr, opts.me)) continue
    const key = pr.ticket ? ticketKey(pr.ticket) : null
    const ticket = key ? opts.tickets[key] ?? null : null
    const ctx = { me: opts.me, parked, ticket }
    const stage = deskStageOf(pr, ctx)
    out[stage].push({ pr, ticket, stage, parkedWhy: stage === 'parked' ? parkedReason(pr, ctx) : null })
  }
  for (const list of Object.values(out)) list.sort((a, b) => b.pr.updatedAt.localeCompare(a.pr.updatedAt))
  return out
}

export interface ProjectRow {
  /** Project id, or null for PRs without one. */
  id: string | null
  project: DeskProject | null
  stages: Record<DeskStage, PlacedPR[]>
  count: number
}

const emptyStages = (): Record<DeskStage, PlacedPR[]> => ({ draft: [], pending: [], ready: [], assigned: [], parked: [] })

/**
 * Splits placed PRs into one row per Notion project: oldest project first (as
 * PR Desk orders them), then any without a created date by name, and PRs with
 * no known project last. Exported for tests.
 */
export function groupByProject(
  placed: Record<DeskStage, PlacedPR[]>,
  projects: Record<string, DeskProject>
): ProjectRow[] {
  const rows = new Map<string | null, ProjectRow>()
  for (const stage of DESK_STAGES) {
    for (const p of placed[stage.id]) {
      const pid = p.ticket?.projectId ?? null
      const id = pid && projects[pid] ? pid : null
      let row = rows.get(id)
      if (!row) {
        row = { id, project: id ? projects[id] : null, stages: emptyStages(), count: 0 }
        rows.set(id, row)
      }
      row.stages[stage.id].push(p)
      row.count++
    }
  }
  const time = (r: ProjectRow) => (r.project?.createdAt ? Date.parse(r.project.createdAt) : NaN)
  return [...rows.values()].sort((a, b) => {
    if (!a.project || !b.project) return a.project ? -1 : b.project ? 1 : 0
    const ta = time(a)
    const tb = time(b)
    if (!Number.isNaN(ta) && !Number.isNaN(tb) && ta !== tb) return ta - tb
    if (Number.isNaN(ta) !== Number.isNaN(tb)) return Number.isNaN(ta) ? 1 : -1
    return a.project.title.localeCompare(b.project.title)
  })
}

const ExternalIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
)

function ReviewChip({ pr }: { pr: DeskPR }) {
  const chips: Array<{ text: string; cls: string; title?: string }> = []
  if (pr.mergeable === 'conflicting') chips.push({ text: 'Conflicts', cls: 'text-danger border-danger/40' })
  switch (pr.review.approved) {
    case 'human':
      chips.push({ text: 'Approved', cls: 'text-success border-success/40', title: pr.review.humanApprovers.join(', ') })
      break
    case 'auto':
      chips.push({ text: 'Auto-approved', cls: 'text-success border-success/40' })
      break
    case 'changes':
      chips.push({ text: 'Changes requested', cls: 'text-danger border-danger/40' })
      break
    case 'stale':
      chips.push({ text: 'Approval stale', cls: 'text-warning border-warning/40', title: 'Auto-review approved an older commit' })
      break
  }
  if (pr.review.requirement === 'human') chips.push({ text: 'Human review', cls: 'text-text-muted border-border' })
  if (chips.length === 0) return null
  return (
    <>
      {chips.map((c) => (
        <span key={c.text} title={c.title} className={`text-[10px] leading-none rounded border ${c.cls}`} style={{ padding: '3px 6px' }}>
          {c.text}
        </span>
      ))}
    </>
  )
}

interface CardProps {
  placed: PlacedPR
  active: boolean
  attention: boolean
  isParkedByMe: boolean
  onOpen: () => void
  onOpenExternal: (url: string) => void
  onTogglePark: () => void
}

function cardKeyDown(onOpen: () => void) {
  return (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onOpen()
    }
  }
}

function CompactCard({ placed, active, attention, onOpen }: CardProps) {
  const { pr, ticket } = placed
  return (
    <div
      role="button"
      tabIndex={0}
      data-testid={`pr-desk-card-${pr.number}`}
      onClick={onOpen}
      onKeyDown={cardKeyDown(onOpen)}
      title={`#${pr.number} ${pr.title}${ticket ? `\n${ticket.ticketId ?? ''} ${ticket.status ?? ''}` : ''}\nby ${pr.author}`}
      style={{ padding: '4px 8px' }}
      className={`flex items-center gap-1.5 rounded text-[11px] cursor-pointer transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
        active ? 'bg-accent/15 text-accent' : 'text-text hover:bg-bg-tertiary'
      }`}
    >
      <CIIndicator status={pr.ciStatus} />
      <span className="shrink-0 text-text-muted tabular-nums">#{pr.number}</span>
      <span className="truncate min-w-0 flex-1">{pr.title}</span>
      {attention && <span aria-label="Agent waiting for attention" className="shrink-0 w-1.5 h-1.5 rounded-full bg-warning" />}
      <Avatar login={pr.author} size={14} />
    </div>
  )
}

function ExpandedCard({ placed, active, attention, isParkedByMe, onOpen, onOpenExternal, onTogglePark }: CardProps) {
  const { pr, ticket, parkedWhy } = placed
  const ticketUrl = ticket?.url || pr.ticket?.url || null
  const ticketId = ticket?.ticketId ?? pr.ticket?.ticketId ?? null
  const labels = pr.labels.filter((l) => !HIDDEN_LABELS.has(l.name))
  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation()
    fn()
  }
  return (
    <div
      role="button"
      tabIndex={0}
      data-testid={`pr-desk-card-${pr.number}`}
      onClick={onOpen}
      onKeyDown={cardKeyDown(onOpen)}
      style={{ padding: '8px 10px' }}
      className={`rounded-md border text-xs cursor-pointer transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
        active ? 'border-accent bg-accent/10' : 'border-border bg-bg hover:bg-bg-tertiary'
      }`}
    >
      <div className="flex items-center gap-1.5 text-[10px] text-text-muted">
        <CIIndicator status={pr.ciStatus} />
        <span className="tabular-nums">#{pr.number}</span>
        {attention && <span aria-label="Agent waiting for attention" className="w-1.5 h-1.5 rounded-full bg-warning" />}
        <span className="ml-auto" title={new Date(pr.updatedAt).toLocaleString()}>{relativeTime(pr.updatedAt)}</span>
      </div>

      <div style={{ marginTop: 4 }} className={`font-medium leading-snug line-clamp-2 ${active ? 'text-accent' : 'text-text'}`}>{pr.title}</div>

      <div className="flex items-center gap-1.5 text-[10px] text-text-muted min-w-0" style={{ marginTop: 6 }}>
        <Avatar login={pr.author} size={14} />
        <span className="shrink-0">{pr.author}</span>
        <span className="truncate" title={`${pr.headRefName} → ${pr.baseRefName}`}>· {pr.headRefName}</span>
      </div>

      {(ticketId || ticket) && (
        <div className="flex items-center gap-1.5 text-[10px] min-w-0" style={{ marginTop: 6 }}>
          {ticketId && <span className="shrink-0 font-mono text-text-muted">{ticketId}</span>}
          {ticket?.status && (
            <span className="shrink-0 rounded bg-bg-tertiary text-text" style={{ padding: '2px 6px' }}>{ticket.status}</span>
          )}
          {ticket?.title && ticket.title !== pr.title && (
            <span className="truncate text-text-muted" title={ticket.title}>{ticket.title}</span>
          )}
        </div>
      )}

      {parkedWhy && <div className="text-[10px] text-warning" style={{ marginTop: 6 }}>{parkedWhy}</div>}

      <div className="flex flex-wrap items-center gap-1" style={{ marginTop: 6 }}>
        <ReviewChip pr={pr} />
        {labels.slice(0, 4).map((l) => (
          <PRLabelChip key={l.name} label={l} />
        ))}
      </div>

      <div className="flex items-center gap-1" style={{ marginTop: 8 }}>
        {ticketUrl && (
          <button
            type="button"
            onClick={stop(() => onOpenExternal(ticketUrl))}
            style={{ padding: '3px 6px' }}
            className="inline-flex items-center gap-1 rounded border border-border text-[10px] text-text-muted hover:text-text hover:bg-bg-tertiary"
            title="Open the ticket in your browser"
          >
            Notion <ExternalIcon />
          </button>
        )}
        <button
          type="button"
          onClick={stop(() => onOpenExternal(pr.url))}
          style={{ padding: '3px 6px' }}
            className="inline-flex items-center gap-1 rounded border border-border text-[10px] text-text-muted hover:text-text hover:bg-bg-tertiary"
          title="Open the PR on GitHub in your browser"
        >
          GitHub <ExternalIcon />
        </button>
        <button
          type="button"
          onClick={stop(onTogglePark)}
          style={{ padding: '3px 6px' }}
          className="ml-auto rounded text-[10px] text-text-muted hover:text-text hover:bg-bg-tertiary"
          title={isParkedByMe ? 'Move it back to its stage' : 'Put this PR on hold'}
        >
          {isParkedByMe ? 'Unpark' : 'Park'}
        </button>
      </div>
    </div>
  )
}

export function PRDeskBoard(props: PRDeskBoardProps) {
  const { prs, tickets, projects, parked, me, view, scope, activePRNumber, attention, onOpen, onOpenExternal, onTogglePark } = props
  const placed = useMemo(() => placePRs(prs, { tickets, parked, me, scope }), [prs, tickets, parked, me, scope])
  const parkedSet = useMemo(() => new Set(parked), [parked])
  const rows = useMemo(
    () => (view === 'expanded' ? groupByProject(placed, projects ?? {}) : []),
    [view, placed, projects]
  )

  const renderCards = (list: PlacedPR[]) => {
    const Card = view === 'compact' ? CompactCard : ExpandedCard
    return list.map((p) => (
      <Card
        key={p.pr.number}
        placed={p}
        active={activePRNumber === p.pr.number}
        attention={!!attention?.(p.pr.number)}
        isParkedByMe={parkedSet.has(p.pr.number)}
        onOpen={() => onOpen(p.pr)}
        onOpenExternal={onOpenExternal}
        onTogglePark={() => onTogglePark(p.pr.number)}
      />
    ))
  }

  const stageHeader = (stage: (typeof DESK_STAGES)[number]) => (
    <div className="flex items-center gap-1.5 min-w-0" style={{ padding: '6px 12px' }}>
      <h3 className="text-[10px] font-semibold uppercase tracking-wide text-text-muted truncate">{stage.label}</h3>
      <span className="text-[10px] text-text-muted tabular-nums">{placed[stage.id].length}</span>
    </div>
  )

  if (view === 'expanded') {
    // One row per Notion project, the stage columns running across every row.
    return (
      <div className="flex-1 min-h-0 flex flex-col" data-testid="pr-desk-board">
        <div className="grid grid-cols-5 divide-x divide-border border-b border-border flex-shrink-0">
          {DESK_STAGES.map((stage) => (
            <React.Fragment key={stage.id}>{stageHeader(stage)}</React.Fragment>
          ))}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {rows.map((row) => {
            const name = row.project?.title ?? 'No project'
            return (
              <section key={row.id ?? '__none'} aria-label={name} className="border-b border-border">
                <div className="flex items-center gap-2 bg-bg-tertiary/40 border-b border-border" style={{ padding: '6px 12px' }}>
                  <h4 className={`text-[11px] font-semibold truncate ${row.project ? 'text-text' : 'text-text-muted'}`}>{name}</h4>
                  <span className="text-[10px] text-text-muted tabular-nums">{row.count}</span>
                  {row.project?.url && (
                    <button
                      type="button"
                      onClick={() => onOpenExternal(row.project!.url)}
                      className="inline-flex items-center gap-1 text-[10px] text-text-muted hover:text-text"
                      title="Open the project in your browser"
                      aria-label={`Open ${name} in Notion`}
                    >
                      <ExternalIcon />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-5 divide-x divide-border">
                  {DESK_STAGES.map((stage) => (
                    <div
                      key={stage.id}
                      role="group"
                      aria-label={`${name}: ${stage.label}`}
                      className="flex flex-col min-w-0"
                      style={{ padding: 8, gap: 8 }}
                    >
                      {renderCards(row.stages[stage.id])}
                    </div>
                  ))}
                </div>
              </section>
            )
          })}
          {rows.length === 0 && <p className="text-[10px] text-text-muted text-center" style={{ padding: '12px 0' }}>No pull requests</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0 grid grid-cols-5 divide-x divide-border" data-testid="pr-desk-board">
      {DESK_STAGES.map((stage) => {
        const list = placed[stage.id]
        return (
          <section key={stage.id} className="flex flex-col min-h-0 min-w-0" aria-label={stage.label}>
            <div className="border-b border-border flex-shrink-0">{stageHeader(stage)}</div>
            <div className="flex-1 min-h-0 overflow-y-auto flex flex-col" style={{ padding: 4, gap: 2 }}>
              {renderCards(list)}
              {list.length === 0 && <p className="text-[10px] text-text-muted text-center" style={{ padding: '12px 0' }}>None</p>}
            </div>
          </section>
        )
      })}
    </div>
  )
}
