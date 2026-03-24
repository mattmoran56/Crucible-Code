import React, { useState } from 'react'
import type { Session } from '../../../shared/types'
import { IconButton } from '../ui/IconButton'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'

interface Props {
  session: Session
  isActive: boolean
  onClick: () => void
  onReactivate: () => void
  onDelete: () => void
}

const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
)

const ReactivateIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="17 1 21 5 17 9" />
    <path d="M3 11V9a4 4 0 0 1 4-4h14" />
    <polyline points="7 23 3 19 7 15" />
    <path d="M21 13v2a4 4 0 0 1-4 4H3" />
  </svg>
)

export function StaleSessionCard({ session, isActive, onClick, onReactivate, onDelete }: Props) {
  const [showConfirm, setShowConfirm] = useState(false)

  return (
    <>
      <button
        onClick={onClick}
        className={`group w-full text-left text-xs transition-colors relative focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset ${
          isActive
            ? 'bg-accent/15 text-accent'
            : 'text-text-muted hover:bg-bg-tertiary'
        }`}
        style={{ padding: '8px 12px' }}
      >
        <div className="flex items-center gap-2">
          <div className="font-medium truncate flex-1 pr-12">{session.name}</div>
        </div>
        <div className="text-text-muted text-[10px] mt-1 truncate pr-12">
          {session.branchName}
        </div>
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1 opacity-0 group-hover:opacity-100">
          <IconButton
            label={`Reactivate ${session.name}`}
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              onReactivate()
            }}
            className="text-accent hover:text-accent-hover"
          >
            <ReactivateIcon />
          </IconButton>
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
