import React, { useState } from 'react'
import type { ClaudeWebSession, PullRequest } from '../../../shared/types'
import { useToastStore } from '../../stores/toastStore'

interface Props {
  session: ClaudeWebSession
  pr?: PullRequest
  opening: boolean
  onOpen: () => void
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  const years = Math.floor(days / 365)
  return `${years}y ago`
}

export function ClaudeWebSessionCard({ session, pr, opening, onOpen }: Props) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => { if (!opening) onOpen() }}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !opening) {
          e.preventDefault()
          onOpen()
        }
      }}
      aria-busy={opening}
      className="group w-full text-left text-xs text-text relative cursor-pointer hover:bg-bg-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset transition-colors"
      style={{ padding: '8px 12px' }}
    >
      <div className="flex items-center gap-2">
        <div className="font-medium truncate flex-1">{session.branchName}</div>
        {opening && (
          <svg className="shrink-0 w-3 h-3 text-accent animate-spin" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
            <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        )}
      </div>
      <div className="text-text-muted text-[10px] mt-1 flex items-center gap-1.5 min-w-0">
        <span className="shrink-0">{relativeTime(session.lastCommitDate)}</span>
        {pr && (
          <>
            <span
              title={pr.isDraft ? 'Draft PR' : 'Open PR'}
              className={`shrink-0 w-1.5 h-1.5 rounded-full ${
                pr.isDraft ? 'bg-text-muted' : 'bg-success'
              }`}
            />
            <span className="text-text-muted text-[10px] truncate">
              #{pr.number} {pr.title}
            </span>
          </>
        )}
      </div>
    </div>
  )
}

interface ContainerProps {
  session: ClaudeWebSession
  pr?: PullRequest
  onOpen: () => Promise<void>
}

export function ClaudeWebSessionCardContainer({ session, pr, onOpen }: ContainerProps) {
  const [opening, setOpening] = useState(false)
  return (
    <ClaudeWebSessionCard
      session={session}
      pr={pr}
      opening={opening}
      onOpen={async () => {
        setOpening(true)
        try {
          await onOpen()
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          useToastStore.getState().addToast('error', `Failed to open ${session.branchName}: ${message}`)
        } finally {
          setOpening(false)
        }
      }}
    />
  )
}
