import React from 'react'
import type { PullRequest } from '../../../shared/types'

interface Props {
  pr: PullRequest
  isNew: boolean
  isActive: boolean
  onClick: () => void
}

export function PRCard({ pr, isNew, isActive, onClick }: Props) {
  return (
    <button
      onClick={onClick}
      className={`group w-full text-left text-xs transition-colors relative focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset ${
        isActive ? 'bg-accent/15 text-accent' : 'text-text hover:bg-bg-tertiary'
      }`}
      style={{ padding: '8px 12px' }}
    >
      <div className="flex items-center gap-1.5">
        <span
          className={`shrink-0 w-1.5 h-1.5 rounded-full ${pr.isDraft ? 'bg-text-muted' : 'bg-success'}`}
        />
        {isNew && (
          <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-accent" />
        )}
        <span className="font-medium truncate">
          #{pr.number} {pr.title}
        </span>
      </div>
      <div className="text-text-muted text-[10px] mt-1 truncate">
        {pr.headRefName} &rarr; {pr.baseRefName}
      </div>
      <div className="text-text-muted text-[10px] mt-0.5 truncate">
        {pr.author}
      </div>
    </button>
  )
}
