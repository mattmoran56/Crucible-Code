import React from 'react'
import type { Session } from '../../../shared/types'

interface Props {
  session: Session
  isActive: boolean
  hasPendingNotification: boolean
  onClick: () => void
}

export function SessionCard({ session, isActive, hasPendingNotification, onClick }: Props) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left text-xs transition-colors ${
        isActive
          ? 'bg-accent/15 text-accent'
          : 'text-text hover:bg-bg-tertiary'
      }`}
      style={{ padding: '8px 12px' }}
    >
      <div className="flex items-center gap-2">
        <div className="font-medium truncate flex-1">{session.name}</div>
        {hasPendingNotification && (
          <span className="shrink-0 w-2 h-2 rounded-full bg-warning" />
        )}
      </div>
      <div className="text-text-muted text-[10px] mt-1 truncate">
        {session.branchName}
      </div>
    </button>
  )
}
