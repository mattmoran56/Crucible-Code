import React from 'react'
import type { Session } from '../../../shared/types'

interface Props {
  session: Session
  isActive: boolean
  onClick: () => void
}

export function SessionCard({ session, isActive, onClick }: Props) {
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
      <div className="font-medium truncate">{session.name}</div>
      <div className="text-text-muted text-[10px] mt-1 truncate">
        {session.branchName}
      </div>
    </button>
  )
}
