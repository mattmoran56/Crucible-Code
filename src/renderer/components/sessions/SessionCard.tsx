import React, { useState } from 'react'
import type { Session, PullRequest, SessionStatus } from '../../../shared/types'
import { IconButton } from '../ui/IconButton'
import { DropdownMenu } from '../ui/DropdownMenu'
import { Dialog } from '../ui/Dialog'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'
import { CIIndicator } from '../pullrequests/CIIndicator'
import { defaultSessionBranch, renameMovesBranch, sessionDeletesLocalBranch, sessionRemoteBranch } from '../../../shared/branch-name'

interface Props {
  session: Session
  isActive: boolean
  isOpenedAsMain: boolean
  status: SessionStatus | null
  pr?: PullRequest
  /** The main checkout's branch, shown on a repo-root agent (which has none of its own). */
  repoBranch?: string | null
  onClick: () => void
  onOpenAsMainBranch: () => void
  /** `deleteRemoteBranch` is only offered for cloud (or teleported) sessions. */
  onDelete: (opts?: { deleteRemoteBranch?: boolean }) => void
  onRename: (newName: string) => Promise<void>
}

const EllipsisIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <circle cx="12" cy="5" r="2" />
    <circle cx="12" cy="12" r="2" />
    <circle cx="12" cy="19" r="2" />
  </svg>
)

const TicketIcon = () => (
  <svg
    aria-hidden="true"
    className="shrink-0"
    width="10"
    height="10"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V8z" />
    <path d="M13 6v2" />
    <path d="M13 11v2" />
    <path d="M13 16v2" />
  </svg>
)

const CloudIcon = () => (
  <svg
    aria-hidden="true"
    className="shrink-0"
    width="10"
    height="10"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z" />
  </svg>
)

const RepoRootIcon = () => (
  <svg
    aria-hidden="true"
    className="shrink-0"
    width="10"
    height="10"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 9l9-6 9 6v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
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

export function SessionCard({ session, isActive, isOpenedAsMain, status, pr, repoBranch, onClick, onOpenAsMainBranch, onDelete, onRename }: Props) {
  const [showConfirm, setShowConfirm] = useState(false)
  const [showRename, setShowRename] = useState(false)
  const [renameValue, setRenameValue] = useState(session.name)
  const [renameError, setRenameError] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [deleteRemote, setDeleteRemote] = useState(false)
  const remoteBranch = session.cloud || session.cloudPending ? sessionRemoteBranch(session) : undefined
  const deletesLocalBranch = sessionDeletesLocalBranch(session)
  const movesBranch = renameMovesBranch(session)

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
          <span className="truncate">{session.repoRoot ? repoBranch ?? '' : session.branchName}</span>
          {session.repoRoot && (
            <span
              title="Runs in the main checkout — no worktree or branch of its own"
              className="shrink-0 inline-flex items-center gap-0.5 rounded border border-border px-1 text-[9px] font-semibold uppercase tracking-wide text-text-muted"
            >
              <RepoRootIcon />
              No worktree
            </span>
          )}
          {session.location === 'cloud' && (
            <span
              title="Running in Claude Code on the web"
              className="shrink-0 inline-flex items-center gap-0.5 rounded border border-border px-1 text-[9px] font-semibold uppercase tracking-wide text-text-muted"
            >
              <CloudIcon />
              Cloud
            </span>
          )}
          {isOpenedAsMain && (
            <span className="shrink-0 inline-flex items-center rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wide bg-accent/20 text-accent">
              Open
            </span>
          )}
        </div>
        {session.notionTicket && (
          <button
            type="button"
            title={`Open Notion ticket: ${session.notionTicket.title}`}
            onClick={(e) => {
              e.stopPropagation()
              window.api.notion.openTicket(session.notionTicket!.url)
            }}
            className="mt-0.5 pr-5 flex items-center gap-1 text-text-muted text-[10px] hover:text-accent hover:underline focus:outline-none focus-visible:text-accent max-w-full"
          >
            <TicketIcon />
            <span className="truncate">{session.notionTicket.title || 'Notion ticket'}</span>
          </button>
        )}
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
              ...(!isOpenedAsMain && !session.repoRoot ? [{ label: 'Open as main branch', onClick: onOpenAsMainBranch }] : []),
              { label: 'Rename', onClick: openRename },
              {
                label: 'Delete',
                variant: 'danger' as const,
                onClick: () => {
                  setDeleteRemote(false)
                  setShowConfirm(true)
                },
              },
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
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!renaming) submitRename()
          }}
          className="flex flex-col gap-5"
        >
          <Input
            label="Session name"
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            placeholder="e.g. fix-auth-bug"
            disabled={renaming}
            error={renameError || undefined}
            hint={
              session.repoRoot
                ? 'Runs in the main checkout, so no git branch changes'
                : movesBranch
                  ? `The git branch will be renamed to ${defaultSessionBranch(renameValue.trim() || '<new name>')}`
                  : `The git branch stays ${session.branchName}`
            }
          />
          <div className="flex gap-3 justify-end">
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowRename(false)} disabled={renaming}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={renaming || !renameValue.trim()} loading={renaming}>
              Save
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={showConfirm} onClose={() => setShowConfirm(false)} title="Delete session?">
        {session.repoRoot ? (
          <p className="text-xs text-text-muted mb-5">
            This will stop the agent and remove <strong className="text-text">{session.name}</strong>. The repo
            and its files are left as they are.
          </p>
        ) : (
          <p className="text-xs text-text-muted mb-5">
            This will remove the worktree{deletesLocalBranch ? ' and local branch' : ''} for{' '}
            <strong className="text-text">{session.name}</strong>. This cannot be undone.
          </p>
        )}
        {remoteBranch && (
          <label className="flex items-center gap-2 text-xs text-text cursor-pointer select-none mb-5">
            <input
              type="checkbox"
              checked={deleteRemote}
              onChange={(e) => setDeleteRemote(e.target.checked)}
              className="cursor-pointer"
            />
            Also delete the remote branch origin/{remoteBranch}
          </label>
        )}
        <div className="flex gap-3 justify-end">
          <Button variant="ghost" size="sm" onClick={() => setShowConfirm(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              setShowConfirm(false)
              onDelete(remoteBranch && deleteRemote ? { deleteRemoteBranch: true } : undefined)
            }}
          >
            Delete
          </Button>
        </div>
      </Dialog>
    </>
  )
}
