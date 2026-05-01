import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PRDetail, PRReviewSummary, GitHubCollaborator } from '../../../shared/types'
import { Avatar } from '../ui/Avatar'

const STATE_LABEL: Record<PRReviewSummary['state'], string> = {
  APPROVED: 'Approved',
  CHANGES_REQUESTED: 'Changes requested',
  COMMENTED: 'Commented',
  PENDING: 'Pending',
  DISMISSED: 'Dismissed',
}

const STATE_COLOR: Record<PRReviewSummary['state'], string> = {
  APPROVED: 'text-success',
  CHANGES_REQUESTED: 'text-danger',
  COMMENTED: 'text-text-muted',
  PENDING: 'text-warning',
  DISMISSED: 'text-text-muted',
}

interface ReviewerRowProps {
  login: string
  state?: PRReviewSummary['state']
  onRemove?: () => void
  removing?: boolean
}

function ReviewerRow({ login, state, onRemove, removing }: ReviewerRowProps) {
  return (
    <div
      className="flex items-center gap-2 text-xs"
      style={{ padding: '4px 0' }}
    >
      <Avatar login={login} />
      <span className="text-text">{login}</span>
      {state && (
        <span className={`text-[10px] ${STATE_COLOR[state]}`}>
          {STATE_LABEL[state]}
        </span>
      )}
      {onRemove && (
        <button
          className="ml-auto text-text-muted hover:text-danger focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded disabled:opacity-50"
          style={{ padding: '2px 4px', fontSize: '12px' }}
          onClick={onRemove}
          disabled={removing}
          aria-label={`Remove ${login} as reviewer`}
          title="Remove reviewer"
        >
          ×
        </button>
      )}
    </div>
  )
}

interface ReviewersSectionProps {
  detail: PRDetail
  collaborators: GitHubCollaborator[]
  onAddReviewer: (login: string) => void | Promise<void>
  onRemoveReviewer: (login: string) => void | Promise<void>
  busy?: boolean
}

export function ReviewersSection({
  detail,
  collaborators,
  onAddReviewer,
  onRemoveReviewer,
  busy,
}: ReviewersSectionProps) {
  // Group reviewers by review state. Pending reviewers (requested but not yet reviewed)
  // come from `requestedReviewers`; everyone else from `reviews`.
  const grouped = useMemo(() => {
    const approved: PRReviewSummary[] = []
    const changes: PRReviewSummary[] = []
    const commented: PRReviewSummary[] = []
    const dismissed: PRReviewSummary[] = []
    for (const r of detail.reviews) {
      switch (r.state) {
        case 'APPROVED': approved.push(r); break
        case 'CHANGES_REQUESTED': changes.push(r); break
        case 'COMMENTED': commented.push(r); break
        case 'DISMISSED': dismissed.push(r); break
        default: break
      }
    }
    const reviewedAuthors = new Set(detail.reviews.map((r) => r.author))
    const pending = detail.requestedReviewers.filter((l) => !reviewedAuthors.has(l))
    return { approved, changes, commented, dismissed, pending }
  }, [detail])

  return (
    <div className="border border-border rounded" style={{ marginBottom: '12px', padding: '8px 12px' }}>
      <div className="text-xs font-medium text-text mb-2">Reviewers</div>

      {grouped.approved.length === 0 &&
        grouped.changes.length === 0 &&
        grouped.commented.length === 0 &&
        grouped.pending.length === 0 && (
          <div className="text-[10px] text-text-muted italic mb-2">
            No reviewers yet.
          </div>
        )}

      {grouped.changes.length > 0 && (
        <ReviewerGroup label="Changes requested">
          {grouped.changes.map((r) => (
            <ReviewerRow key={r.author} login={r.author} state={r.state} />
          ))}
        </ReviewerGroup>
      )}

      {grouped.approved.length > 0 && (
        <ReviewerGroup label="Approved">
          {grouped.approved.map((r) => (
            <ReviewerRow key={r.author} login={r.author} state={r.state} />
          ))}
        </ReviewerGroup>
      )}

      {grouped.commented.length > 0 && (
        <ReviewerGroup label="Commented">
          {grouped.commented.map((r) => (
            <ReviewerRow key={r.author} login={r.author} state={r.state} />
          ))}
        </ReviewerGroup>
      )}

      {grouped.pending.length > 0 && (
        <ReviewerGroup label="Awaiting review">
          {grouped.pending.map((login) => (
            <ReviewerRow
              key={login}
              login={login}
              state="PENDING"
              onRemove={() => onRemoveReviewer(login)}
              removing={busy}
            />
          ))}
        </ReviewerGroup>
      )}

      <ReviewerPicker
        collaborators={collaborators}
        existingLogins={new Set([
          ...detail.requestedReviewers,
          ...detail.reviews.map((r) => r.author),
        ])}
        prAuthor={detail.author}
        onPick={onAddReviewer}
        disabled={busy}
      />
    </div>
  )
}

function ReviewerGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '6px' }}>
      <div className="text-[10px] uppercase tracking-wide text-text-muted" style={{ marginBottom: '2px' }}>
        {label}
      </div>
      {children}
    </div>
  )
}

interface ReviewerPickerProps {
  collaborators: GitHubCollaborator[]
  existingLogins: Set<string>
  prAuthor: string
  onPick: (login: string) => void
  disabled?: boolean
}

function ReviewerPicker({ collaborators, existingLogins, prAuthor, onPick, disabled }: ReviewerPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const candidates = useMemo(() => {
    const lower = query.toLowerCase()
    const list = collaborators
      .filter((c) => c.login !== prAuthor && !existingLogins.has(c.login))
      .filter((c) => !lower || c.login.toLowerCase().includes(lower))
      .slice(0, 50)
    if (query.trim() && !list.some((c) => c.login.toLowerCase() === lower)) {
      // Always offer the typed value as a free-form candidate (e.g. teams or
      // collaborators not in the cached list).
      list.unshift({ login: query.trim() })
    }
    return list
  }, [collaborators, existingLogins, prAuthor, query])

  useEffect(() => {
    setHighlight(0)
  }, [candidates.length])

  useEffect(() => {
    if (!open) return
    const update = () => {
      if (!triggerRef.current) return
      const rect = triggerRef.current.getBoundingClientRect()
      setPos({ top: rect.bottom + 2, left: rect.left, width: Math.max(rect.width, 220) })
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    const onMouseDown = (e: MouseEvent) => {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target as Node) &&
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const pick = (login: string) => {
    if (!login) return
    setOpen(false)
    setQuery('')
    onPick(login)
  }

  return (
    <>
      <button
        ref={triggerRef}
        className="text-[10px] text-accent hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded disabled:opacity-50"
        style={{ padding: '2px 0' }}
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
      >
        + Request review
      </button>
      {open && createPortal(
        <div
          ref={dropdownRef}
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            width: pos.width,
            zIndex: 9999,
          }}
          className="rounded border border-border bg-bg-secondary shadow-lg"
        >
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setHighlight((i) => Math.min(i + 1, candidates.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setHighlight((i) => Math.max(i - 1, 0))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                pick(candidates[highlight]?.login || query.trim())
              }
            }}
            placeholder="Type a GitHub username..."
            className="w-full bg-bg text-text text-xs border-b border-border focus:outline-none"
            style={{ padding: '6px 10px' }}
          />
          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
            {candidates.length === 0 ? (
              <div className="text-[10px] text-text-muted" style={{ padding: '6px 10px' }}>
                No matching collaborators
              </div>
            ) : (
              candidates.map((c, i) => (
                <div
                  key={c.login}
                  role="option"
                  aria-selected={i === highlight}
                  className={`text-xs cursor-pointer flex items-center gap-2 ${
                    i === highlight ? 'bg-accent/15 text-accent' : 'text-text hover:bg-bg-tertiary'
                  }`}
                  style={{ padding: '6px 10px' }}
                  onMouseEnter={() => setHighlight(i)}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    pick(c.login)
                  }}
                >
                  <Avatar login={c.login} />
                  <span>{c.login}</span>
                </div>
              ))
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
