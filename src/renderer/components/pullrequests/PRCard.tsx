import React from 'react'
import type { PullRequest } from '../../../shared/types'
import { CIIndicator } from './CIIndicator'

interface Props {
  pr: PullRequest
  isNew: boolean
  isActive: boolean
  needsAttention?: boolean
  onClick: () => void
}

export function PRCard({ pr, isNew, isActive, needsAttention, onClick }: Props) {
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
          title={pr.state === 'MERGED' ? 'Merged' : pr.isDraft ? 'Draft' : 'Open'}
          className={`shrink-0 w-1.5 h-1.5 rounded-full ${
            pr.state === 'MERGED' ? 'bg-merged' : pr.isDraft ? 'bg-text-muted' : 'bg-success'
          }`}
        />
        <CIIndicator status={pr.ciStatus} />
        {isNew && (
          <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-accent" />
        )}
        <span className="font-medium truncate">
          #{pr.number} {pr.title}
        </span>
        {needsAttention && (
          <span
            aria-label="Agent waiting for attention"
            className="ml-auto shrink-0 w-2 h-2 rounded-full bg-warning"
          />
        )}
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
