import React, { useState } from 'react'
import type { Session, PullRequest } from '../../../shared/types'
import { IconButton } from '../ui/IconButton'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'

interface Props {
  session: Session
  isActive: boolean
  hasPendingNotification: boolean
  pr?: PullRequest
  onClick: () => void
  onDelete: () => void
}

const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
)

export function SessionCard({ session, isActive, hasPendingNotification, pr, onClick, onDelete }: Props) {
  const [showConfirm, setShowConfirm] = useState(false)

  return (
    <>
      <button
        onClick={onClick}
        className={`group w-full text-left text-xs transition-colors relative focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset ${
          isActive
            ? 'bg-accent/15 text-accent'
            : 'text-text hover:bg-bg-tertiary'
        }`}
        style={{ padding: '8px 12px' }}
      >
        <div className="flex items-center gap-2">
          <div className="font-medium truncate flex-1 pr-5">{session.name}</div>
          {hasPendingNotification && (
            <span className="shrink-0 w-2 h-2 rounded-full bg-warning" />
          )}
        </div>
        <div className="text-text-muted text-[10px] mt-1 truncate pr-5">
          {session.branchName}
        </div>
        {pr && (
          <div className="flex items-center gap-1 mt-0.5 pr-5">
            <span
              className={`shrink-0 w-1.5 h-1.5 rounded-full ${pr.isDraft ? 'bg-text-muted' : 'bg-success'}`}
            />
            <span className="text-text-muted text-[10px] truncate">
              #{pr.number} {pr.title}
            </span>
          </div>
        )}
        <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100">
          <IconButton
            label={`Delete ${session.name}`}
            variant="danger"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              setShowConfirm(true)
            }}
          >
            <TrashIcon />
          </IconButton>
        </div>
      </button>

      <Dialog open={showConfirm} onClose={() => setShowConfirm(false)} title="Delete session?">
        <p className="text-xs text-text-muted mb-5">
          This will remove the worktree and branch for{' '}
          <strong className="text-text">{session.name}</strong>. This cannot be undone.
        </p>
        <div className="flex gap-3 justify-end">
          <Button variant="ghost" size="sm" onClick={() => setShowConfirm(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              setShowConfirm(false)
              onDelete()
            }}
          >
            Delete
          </Button>
        </div>
      </Dialog>
    </>
  )
}
