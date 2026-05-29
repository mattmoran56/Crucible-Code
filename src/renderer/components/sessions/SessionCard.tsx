import React, { useState } from 'react'
import type { Session, PullRequest, SessionStatus } from '../../../shared/types'
import { IconButton } from '../ui/IconButton'
import { DropdownMenu } from '../ui/DropdownMenu'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { CIIndicator } from '../pullrequests/CIIndicator'

interface Props {
  session: Session
  isActive: boolean
  isOpenedAsMain: boolean
  status: SessionStatus | null
  pr?: PullRequest
  onClick: () => void
  onOpenAsMainBranch: () => void
  onDelete: () => void
  onRename: (newName: string) => Promise<void>
}

const EllipsisIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <circle cx="12" cy="5" r="2" />
    <circle cx="12" cy="12" r="2" />
    <circle cx="12" cy="19" r="2" />
  </svg>
)

function StatusIndicator({ status }: { status: SessionStatus | null }) {
  if (!status) return null

  switch (status) {
    case 'running':
      return (
        <svg className="shrink-0 w-3 h-3 text-accent animate-spin" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
          <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      )
    case 'attention':
      return <span className="shrink-0 w-2 h-2 rounded-full bg-warning" />
    case 'completed':
      return (
        <svg className="shrink-0 w-3 h-3 text-success" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3.5 8.5 6.5 11.5 12.5 4.5" />
        </svg>
      )
  }
}

export function SessionCard({ session, isActive, isOpenedAsMain, status, pr, onClick, onOpenAsMainBranch, onDelete, onRename }: Props) {
  const [showConfirm, setShowConfirm] = useState(false)
  const [showRename, setShowRename] = useState(false)
  const [renameValue, setRenameValue] = useState(session.name)
  const [renameError, setRenameError] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)

  const openRename = () => {
    setRenameValue(session.name)
    setRenameError(null)
    setShowRename(true)
  }

  const submitRename = async () => {
    setRenaming(true)
    setRenameError(null)
    try {
      await onRename(renameValue)
      setShowRename(false)
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : String(err))
    } finally {
      setRenaming(false)
    }
  }

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick() }}
        className={`group w-full text-left text-xs transition-colors relative focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset cursor-default ${
          isOpenedAsMain
            ? 'bg-accent/10 border-l-2 border-l-accent'
            : ''
        } ${
          isActive
            ? 'bg-accent/15 text-accent'
            : 'text-text hover:bg-bg-tertiary'
        }`}
        style={{ padding: '8px 12px' }}
      >
        <div className="flex items-center gap-2">
          <div className="font-medium truncate flex-1 pr-5">{session.name}</div>
          <StatusIndicator status={status} />
        </div>
        <div className="text-text-muted text-[10px] mt-1 flex items-center gap-1.5 pr-5">
          <span className="truncate">{session.branchName}</span>
          {isOpenedAsMain && (
            <span className="shrink-0 inline-flex items-center rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wide bg-accent/20 text-accent">
              Open
            </span>
          )}
        </div>
        {pr && (
          <div className="flex items-center gap-1 mt-0.5 pr-5">
            <span
              title={pr.state === 'MERGED' ? 'Merged' : pr.isDraft ? 'Draft' : 'Open'}
              className={`shrink-0 w-1.5 h-1.5 rounded-full ${
                pr.state === 'MERGED' ? 'bg-merged' : pr.isDraft ? 'bg-text-muted' : 'bg-success'
              }`}
            />
            <CIIndicator status={pr.ciStatus} />
            <span className="text-text-muted text-[10px] truncate">
              #{pr.number} {pr.title}
            </span>
          </div>
        )}
        <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100">
          <DropdownMenu
            items={[
              ...(!isOpenedAsMain ? [{ label: 'Open as main branch', onClick: onOpenAsMainBranch }] : []),
              { label: 'Rename', onClick: openRename },
              { label: 'Delete', variant: 'danger' as const, onClick: () => setShowConfirm(true) },
            ]}
          >
            <IconButton
              label={`Actions for ${session.name}`}
              size="sm"
            >
              <EllipsisIcon />
            </IconButton>
          </DropdownMenu>
        </div>
      </div>

      <Dialog open={showRename} onClose={() => !renaming && setShowRename(false)} title="Rename session">
        <p className="text-xs text-text-muted mb-3">
          The git branch will be renamed to <code className="text-text">session/&lt;new name&gt;</code>.
        </p>
        <input
          type="text"
          autoFocus
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !renaming) {
              e.preventDefault()
              submitRename()
            }
          }}
          disabled={renaming}
          className="w-full px-2 py-1.5 text-xs bg-bg-tertiary border border-border rounded focus:outline-none focus:border-accent text-text"
        />
        {renameError && (
          <p className="text-xs text-danger mt-2">{renameError}</p>
        )}
        <div className="flex gap-3 justify-end mt-5">
          <Button variant="ghost" size="sm" onClick={() => setShowRename(false)} disabled={renaming}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={submitRename} disabled={renaming || !renameValue.trim()}>
            {renaming ? 'Renaming…' : 'Save'}
          </Button>
        </div>
      </Dialog>

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
