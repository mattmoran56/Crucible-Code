import React, { useState } from 'react'
import type { Session } from '../../../shared/types'

interface Props {
  session: Session
  isActive: boolean
  onClick: () => void
  onDelete: () => void
}

export function SessionCard({ session, isActive, onClick, onDelete }: Props) {
  const [showConfirm, setShowConfirm] = useState(false)

  return (
    <>
      <button
        onClick={onClick}
        className={`group w-full text-left text-xs transition-colors relative ${
          isActive
            ? 'bg-accent/15 text-accent'
            : 'text-text hover:bg-bg-tertiary'
        }`}
        style={{ padding: '8px 12px' }}
      >
        <div className="font-medium truncate pr-5">{session.name}</div>
        <div className="text-text-muted text-[10px] mt-1 truncate pr-5">
          {session.branchName}
        </div>
        <span
          onClick={(e) => {
            e.stopPropagation()
            setShowConfirm(true)
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 text-danger hover:text-danger/80 transition-opacity cursor-pointer"
          title="Delete session"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </span>
      </button>

      {showConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-bg-secondary border border-border rounded-lg" style={{ padding: '24px 28px', width: '340px' }}>
            <h3 className="text-sm font-semibold mb-2">Delete session?</h3>
            <p className="text-xs text-text-muted mb-5">
              This will remove the worktree and branch for <strong className="text-text">{session.name}</strong>. This cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowConfirm(false)}
                className="px-4 py-1.5 text-xs text-text-muted hover:text-text transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowConfirm(false)
                  onDelete()
                }}
                className="px-4 py-1.5 text-xs bg-danger text-white rounded hover:bg-danger/80 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
