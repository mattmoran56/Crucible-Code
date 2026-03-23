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
      className={`w-full text-left px-4 py-3 rounded text-xs transition-colors ${
        isActive
          ? 'bg-accent/15 text-accent'
          : 'text-text hover:bg-bg-tertiary'
      }`}
    >
      <div className="font-medium truncate">{session.name}</div>
      <div className="text-text-muted text-[10px] mt-0.5 truncate">
        {session.branchName}
      </div>
    </button>
  )
}
