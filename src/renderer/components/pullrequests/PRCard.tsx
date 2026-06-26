import React from 'react'
import type { PullRequest, PRReviewSummary } from '../../../shared/types'
import type { PRListDisplay } from '../../../shared/prDisplay'
import { DEFAULT_PR_LIST_DISPLAY } from '../../../shared/prDisplay'
import { CIIndicator } from './CIIndicator'
import { PRLabelChip } from './PRLabelChip'
import { Avatar } from '../ui/Avatar'

interface Props {
  pr: PullRequest
  isNew: boolean
  isActive: boolean
  needsAttention?: boolean
  display?: PRListDisplay
  onClick: () => void
  /** Promote a local PR to a real GitHub PR. Only used when `pr.isLocal`. */
  onPromote?: () => void
  /** Discard a local PR. Only used when `pr.isLocal`. */
  onDiscard?: () => void
}

const REVIEW_STATE_RING: Record<PRReviewSummary['state'], string> = {
  APPROVED: 'ring-1 ring-success',
  CHANGES_REQUESTED: 'ring-1 ring-danger',
  COMMENTED: 'ring-1 ring-text-muted',
  PENDING: 'ring-1 ring-warning',
  DISMISSED: 'ring-1 ring-text-muted opacity-60',
}

const AVATAR_SIZE = 16

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo`
  const years = Math.floor(days / 365)
  return `${years}y`
}

function filterLabels(pr: PullRequest, display: PRListDisplay): PullRequest['labels'] {
  if (display.labelFilter.mode === 'all') return pr.labels
  const allowed = new Set(display.labelFilter.names)
  return pr.labels.filter((l) => allowed.has(l.name))
}

interface PeopleRowProps {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
}

function PeopleRow({ icon, label, children }: PeopleRowProps) {
  return (
    <div className="flex items-center gap-2 mt-2 text-[10px] text-text-muted" title={label}>
      <span className="flex items-center gap-1 shrink-0">
        {icon}
        <span>{label}</span>
      </span>
      <span className="flex flex-wrap items-center gap-1.5 min-w-0">{children}</span>
    </div>
  )
}

export function PRCard({ pr, isNew, isActive, needsAttention, display, onClick, onPromote, onDiscard }: Props) {
  const cfg = display ?? DEFAULT_PR_LIST_DISPLAY
  const fields = cfg.fields

  const visibleLabels = fields.labels ? filterLabels(pr, cfg) : []
  const reviewByAuthor = new Map(pr.reviews.map((r) => [r.author, r] as const))
  const requestedToShow = fields.requestedReviewers
    ? pr.requestedReviewers.filter((l) => !reviewByAuthor.has(l))
    : []

  const showLabelsRow = fields.labels && visibleLabels.length > 0
  const showRequested = fields.requestedReviewers && requestedToShow.length > 0
  const showReviewers = fields.reviewerStates && pr.reviews.length > 0
  const showAssignees = fields.assignees && pr.assignees.length > 0
  const showComments = fields.commentsCount && pr.commentsCount > 0
  const showUpdated = fields.updatedAt
  const showStatsRow = showComments || showUpdated

  return (
    <button
      onClick={onClick}
      className={`group w-full text-left text-xs transition-colors relative focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset ${
        isActive ? 'bg-accent/15 text-accent' : 'text-text hover:bg-bg-tertiary'
      }`}
      style={{ padding: '10px 12px' }}
    >
      <div className="flex items-center gap-1.5">
        {fields.state && (
          <span
            title={pr.state === 'MERGED' ? 'Merged' : pr.isDraft ? 'Draft' : 'Open'}
            className={`shrink-0 w-1.5 h-1.5 rounded-full ${
              pr.state === 'MERGED' ? 'bg-merged' : pr.isDraft ? 'bg-text-muted' : 'bg-success'
            }`}
          />
        )}
        {fields.ci && <CIIndicator status={pr.ciStatus} />}
        {fields.unseen && isNew && (
          <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-accent" />
        )}
        {pr.isLocal && (
          <span
            title="Local PR — not yet on GitHub. Promote to open a real PR."
            className="shrink-0 rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wide bg-warning/20 text-warning"
          >
            Local
          </span>
        )}
        <span className="font-medium truncate">
          {fields.number ? (pr.isLocal ? `LOCAL-${-pr.number} ` : `#${pr.number} `) : ''}{pr.title}
        </span>
        {fields.attention && needsAttention && (
          <span
            aria-label="Agent waiting for attention"
            className="ml-auto shrink-0 w-2 h-2 rounded-full bg-warning"
          />
        )}
      </div>

      {fields.branches && (
        <div className="text-text-muted text-[10px] mt-1.5 truncate">
          {pr.headRefName} &rarr; {pr.baseRefName}
        </div>
      )}

      {fields.author && (
        <div className="text-text-muted text-[10px] mt-1 truncate">
          {pr.author}
        </div>
      )}

      {showLabelsRow && (
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {visibleLabels.map((l) => (
            <PRLabelChip key={l.name} label={l} />
          ))}
        </div>
      )}

      {showRequested && (
        <PeopleRow
          label="Requested"
          icon={
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 11h-6" />
            </svg>
          }
        >
          {requestedToShow.slice(0, 5).map((login) => (
            <Avatar key={login} login={login} size={AVATAR_SIZE} />
          ))}
          {requestedToShow.length > 5 && <span>+{requestedToShow.length - 5}</span>}
        </PeopleRow>
      )}

      {showReviewers && (
        <PeopleRow
          label="Reviewers"
          icon={
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          }
        >
          {pr.reviews.slice(0, 5).map((r) => (
            <Avatar
              key={r.author}
              login={r.author}
              size={AVATAR_SIZE}
              title={`${r.author} — ${r.state.replace('_', ' ').toLowerCase()}`}
              ringClassName={REVIEW_STATE_RING[r.state]}
            />
          ))}
          {pr.reviews.length > 5 && <span>+{pr.reviews.length - 5}</span>}
        </PeopleRow>
      )}

      {showAssignees && (
        <PeopleRow
          label="Assignees"
          icon={
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          }
        >
          {pr.assignees.slice(0, 5).map((login) => (
            <Avatar key={login} login={login} size={AVATAR_SIZE} />
          ))}
          {pr.assignees.length > 5 && <span>+{pr.assignees.length - 5}</span>}
        </PeopleRow>
      )}

      {showStatsRow && (
        <div className="flex items-center gap-3 mt-2.5 text-[10px] text-text-muted">
          {showComments && (
            <span className="flex items-center gap-1" title={`${pr.commentsCount} comments`}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              {pr.commentsCount}
            </span>
          )}
          {showUpdated && (
            <span className="ml-auto" title={new Date(pr.updatedAt).toLocaleString()}>
              {relativeTime(pr.updatedAt)}
            </span>
          )}
        </div>
      )}

      {pr.isLocal && (onPromote || onDiscard) && (
        <div className="flex items-center gap-2 mt-2.5">
          {onPromote && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); onPromote() }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); onPromote() } }}
              className="rounded px-2 py-0.5 text-[10px] font-medium bg-accent/15 text-accent hover:bg-accent/25 cursor-pointer"
            >
              Promote to PR
            </span>
          )}
          {onDiscard && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); onDiscard() }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); onDiscard() } }}
              className="rounded px-2 py-0.5 text-[10px] font-medium text-text-muted hover:text-danger cursor-pointer"
            >
              Discard
            </span>
          )}
        </div>
      )}
    </button>
  )
}
