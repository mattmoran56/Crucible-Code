// The Agent tab for a cloud session: a slim toolbar (styled like the visual
// agent's session bar) over, in turn: the `claude --cloud` terminal that
// creates the cloud session, the embedded claude.ai/code session page, and —
// once teleported — the terminal the session came down into.

import React, { useState } from 'react'
import type { Session } from '../../../shared/types'
import { shortCloudId } from '../../../shared/cloud-session'
import { cn } from '../../lib/cn'
import { TerminalView } from '../terminal/TerminalView'
import { Spinner } from '../visual-agent/icons'
import { CloudWebView } from './CloudWebView'
import { BranchIcon, CloudIcon, ExternalIcon, TeleportIcon } from './icons'

/** Teleport checked out a different branch than the one the app created. */
export interface BranchNotice {
  /** The branch the app created for the cloud session. */
  expected: string
  /** The branch the worktree is on after the teleport (now session.branchName). */
  actual: string
}

export type CloudAgentPhase =
  /** `claude --cloud <task>` is running in the terminal; no session id yet. */
  | 'creating'
  /** The create CLI exited (or the push failed) without a session id. */
  | 'create-failed'
  /** A pending session with no create run (the app restarted mid-create). */
  | 'create-interrupted'
  /** The embedded claude.ai/code page is shown. */
  | 'web'
  /** Checking the worktree before a teleport. */
  | 'teleport-checking'
  /** The worktree has changes; teleport refused. */
  | 'teleport-blocked'
  /** `claude --teleport <id>` is running — then it is the live local session. */
  | 'teleported'
  /** The teleported (now local) Claude session exited. */
  | 'teleport-ended'
  /** Something failed; see `error`. */
  | 'error'

const BAR_BTN =
  'inline-flex items-center gap-1 rounded-md border border-transparent px-1.5! py-[2px]! text-[11px] text-text-muted transition-colors hover:border-border hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 disabled:pointer-events-none'

const TELEPORT_BTN =
  'inline-flex items-center gap-1 rounded-md border border-accent/60 bg-accent/10 px-2! py-[2px]! text-[11px] font-medium text-accent transition-colors hover:bg-accent/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 disabled:pointer-events-none'

export interface CloudAgentPanelProps {
  session: Session
  visible: boolean
  phase: CloudAgentPhase
  /** The teleport PTY, once a teleport is running. */
  terminalId: string | null
  error?: string | null
  dirtyFiles?: string[]
  onOpenInBrowser: () => void
  /** Called once the user has confirmed. */
  onTeleport: () => void
  /** Dismiss an error and go back to the embedded page. */
  onDismissError: () => void
  /** After the teleported session ends: reopen the Agent tab as a local visual agent. */
  onOpenLocally?: () => void
  branchNotice?: BranchNotice | null
  /** Delete the now-unused branch the app created (local + origin). Resolves to a status line. */
  onCleanupBranch?: (branch: string) => Promise<string>
  /** Force the real <webview> (tests) or its stub (stories). */
  embedWebview?: boolean
  /** create-failed: Claude was cancelled after sending the request, so a session may exist. */
  mayExist?: boolean
  /** Start the interactive create again. */
  onRetryCreate?: () => void
  /** Open claude.ai/code (the session list). */
  onOpenCloudHome?: () => void
  /** Remove the pending session (worktree, branch). Offered while it has no cloud session. */
  onDeleteSession?: () => Promise<void> | void
  /** The create CLI is still running after the session was created. */
  cliAttached?: boolean
  /** Whether the attached CLI's terminal is shown instead of the page. */
  showingCli?: boolean
  onToggleCli?: () => void
  /** End the local CLI (the cloud session keeps running). */
  onCloseCli?: () => void
}

export function CloudAgentPanel({
  session,
  visible,
  phase,
  terminalId,
  error,
  dirtyFiles,
  onOpenInBrowser,
  onTeleport,
  onDismissError,
  onOpenLocally,
  branchNotice,
  onCleanupBranch,
  embedWebview,
  mayExist,
  onRetryCreate,
  onOpenCloudHome,
  onDeleteSession,
  cliAttached,
  showingCli,
  onToggleCli,
  onCloseCli,
}: CloudAgentPanelProps) {
  const [confirming, setConfirming] = useState(false)
  const cloud = session.cloud
  const teleported = phase === 'teleported' || phase === 'teleport-ended'
  const canTeleport = !teleported && phase !== 'teleport-checking' && !!cloud

  return (
    <div
      className={cn('relative flex min-h-0 flex-1 flex-col overflow-hidden bg-bg text-text', !visible && 'hidden')}
      data-testid="cloud-agent-panel"
    >
      <div className="flex h-8 shrink-0 items-center gap-2.5 border-b border-border bg-bg-secondary px-3! text-[11px]">
        <span className="flex items-center gap-1.5 font-medium text-text">
          <CloudIcon size={13} className={teleported ? 'text-text-muted' : 'text-accent'} />
          {teleported ? (
            <span className="rounded-full border border-border px-1.5! text-[10px] text-text-muted">Teleported · Local</span>
          ) : (
            <span className="rounded-full border border-accent/50 bg-accent/10 px-1.5! text-[10px] text-accent">Cloud</span>
          )}
        </span>
        {cloud ? (
          <>
            <span className="text-text-muted" aria-hidden="true">
              ·
            </span>
            <code className="font-mono text-[10.5px] text-text-muted" title={`Cloud session ${cloud.sessionId}`}>
              {shortCloudId(cloud.sessionId)}
            </code>
          </>
        ) : null}
        {session.branchName ? (
          <span
            className="flex min-w-0 items-center gap-1 text-text-muted"
            title={`The cloud agent commits and pushes to ${session.branchName}`}
            data-testid="cloud-branch"
          >
            <BranchIcon size={11} />
            <code className="truncate font-mono text-[10.5px]">{session.branchName}</code>
          </span>
        ) : null}
        <PhaseLabel phase={phase} />

        <span className="flex-1" />

        {cloud ? (
          <button type="button" onClick={onOpenInBrowser} className={BAR_BTN} title={cloud.url}>
            <ExternalIcon size={11} /> Open in browser
          </button>
        ) : null}
        {confirming ? (
          <span className="flex items-center gap-1" role="group" aria-label="Confirm teleport">
            <span className="text-text" title={session.worktreePath}>
              Bring this session down to your machine? It will continue locally in{' '}
              <code className="font-mono text-[10.5px]">{session.worktreePath}</code>
            </span>
            <button
              type="button"
              autoFocus
              onClick={() => {
                setConfirming(false)
                onTeleport()
              }}
              className={TELEPORT_BTN}
            >
              Teleport
            </button>
            <button type="button" onClick={() => setConfirming(false)} className={BAR_BTN}>
              Cancel
            </button>
          </span>
        ) : !teleported && cloud ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={!canTeleport}
            className={TELEPORT_BTN}
            title="Pull this session down to the local worktree and continue it here"
          >
            {phase === 'teleport-checking' ? <Spinner /> : <TeleportIcon size={12} />} Teleport
          </button>
        ) : null}
      </div>

      <Banner
        phase={phase}
        error={error}
        dirtyFiles={dirtyFiles}
        onOpenInBrowser={cloud ? onOpenInBrowser : undefined}
        onDismissError={onDismissError}
        onOpenLocally={onOpenLocally}
        mayExist={mayExist}
        onRetryCreate={onRetryCreate}
        onOpenCloudHome={onOpenCloudHome}
        onDeleteSession={onDeleteSession}
      />
      {cliAttached ? (
        <div
          role="status"
          className="flex shrink-0 items-center gap-2 border-b border-border bg-bg-secondary px-3! py-1! text-[11px] text-text-muted"
          data-testid="cloud-cli-attached"
        >
          <span className="min-w-0 flex-1">
            Local CLI still attached to this cloud session. Closing it leaves the session running in the cloud.
          </span>
          {onToggleCli ? (
            <button type="button" onClick={onToggleCli} className={BAR_BTN}>
              {showingCli ? 'Show claude.ai' : 'Show terminal'}
            </button>
          ) : null}
          {onCloseCli ? (
            <button type="button" onClick={onCloseCli} className={BAR_BTN}>
              Close
            </button>
          ) : null}
        </div>
      ) : null}
      {branchNotice ? <BranchNoticeBar notice={branchNotice} onCleanup={onCleanupBranch} /> : null}

      {terminalId ? (
        <div className="relative min-h-0 flex-1">
          <TerminalView terminalId={terminalId} sessionId={session.id} sessionName={session.name} visible={visible} />
        </div>
      ) : cloud && !teleported ? (
        // The page goes away (and its guest is torn down) once teleported.
        <CloudWebView url={cloud.url} visible={visible} onOpenInBrowser={onOpenInBrowser} embed={embedWebview} />
      ) : (
        <div className="relative min-h-0 flex-1" />
      )}
    </div>
  )
}

/** Delete a pending session (worktree + branch), after a confirm. */
function DeleteSessionButton({ onDelete }: { onDelete: () => Promise<void> | void }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className={BAR_BTN}>
        Delete session…
      </button>
    )
  }
  return (
    <span className="flex items-center gap-1" role="group" aria-label="Confirm delete session">
      <span>Delete the worktree and branch?</span>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          try {
            await onDelete()
          } finally {
            setBusy(false)
            setConfirming(false)
          }
        }}
        className={TELEPORT_BTN}
      >
        {busy ? <Spinner /> : null} Delete
      </button>
      <button type="button" onClick={() => setConfirming(false)} disabled={busy} className={BAR_BTN}>
        Cancel
      </button>
    </span>
  )
}

/**
 * Teleport put the worktree on a different branch than the app created. The
 * session now follows the real branch; cleanup of the old one is offered,
 * never run on its own.
 */
function BranchNoticeBar({ notice, onCleanup }: { notice: BranchNotice; onCleanup?: (branch: string) => Promise<string> }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const run = async () => {
    if (!onCleanup) return
    setBusy(true)
    try {
      setStatus(await onCleanup(notice.expected))
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }
  return (
    <div role="status" className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-bg-secondary px-3! py-1.5! text-[11.5px] text-text">
      <span className="min-w-0 flex-1">
        Teleport checked out <code className="font-mono text-[10.5px]">{notice.actual}</code>, not{' '}
        <code className="font-mono text-[10.5px]">{notice.expected}</code>. This session now follows{' '}
        <code className="font-mono text-[10.5px]">{notice.actual}</code>.
      </span>
      {status ? <span className="text-text-muted">{status}</span> : null}
      {onCleanup && !status ? (
        confirming ? (
          <span className="flex items-center gap-1" role="group" aria-label="Confirm branch cleanup">
            <span>
              Delete <code className="font-mono text-[10.5px]">{notice.expected}</code> locally and on origin?
            </span>
            <button type="button" onClick={() => void run()} disabled={busy} className={TELEPORT_BTN}>
              {busy ? <Spinner /> : null} Delete
            </button>
            <button type="button" onClick={() => setConfirming(false)} disabled={busy} className={BAR_BTN}>
              Cancel
            </button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} className={BAR_BTN}>
            Delete unused branch…
          </button>
        )
      ) : null}
    </div>
  )
}

function PhaseLabel({ phase }: { phase: CloudAgentPhase }) {
  const text: Partial<Record<CloudAgentPhase, string>> = {
    creating: 'starting cloud session…',
    'create-failed': 'not started',
    'create-interrupted': 'not started',
    'teleport-checking': 'checking worktree…',
    teleported: 'running locally',
    'teleport-ended': 'local session ended',
  }
  const label = text[phase]
  if (!label) return null
  return (
    <span className="text-text-muted" role="status">
      · {label}
    </span>
  )
}

function Banner({
  phase,
  error,
  dirtyFiles,
  onOpenInBrowser,
  onDismissError,
  onOpenLocally,
  mayExist,
  onRetryCreate,
  onOpenCloudHome,
  onDeleteSession,
}: {
  phase: CloudAgentPhase
  error?: string | null
  dirtyFiles?: string[]
  onOpenInBrowser?: () => void
  onDismissError: () => void
  onOpenLocally?: () => void
  mayExist?: boolean
  onRetryCreate?: () => void
  onOpenCloudHome?: () => void
  onDeleteSession?: () => Promise<void> | void
}) {
  let tone: 'danger' | 'info' = 'info'
  let body: React.ReactNode = null
  let actions: React.ReactNode = null
  const openBtn = onOpenInBrowser ? (
    <button type="button" onClick={onOpenInBrowser} className={BAR_BTN}>
      <ExternalIcon size={11} /> Open in browser
    </button>
  ) : null

  const createActions = (retryLabel: string) => (
    <>
      {onRetryCreate ? (
        <button type="button" onClick={onRetryCreate} className={TELEPORT_BTN}>
          {retryLabel}
        </button>
      ) : null}
      {onOpenCloudHome ? (
        <button type="button" onClick={onOpenCloudHome} className={BAR_BTN}>
          <ExternalIcon size={11} /> Open claude.ai/code
        </button>
      ) : null}
      {onDeleteSession ? <DeleteSessionButton onDelete={onDeleteSession} /> : null}
    </>
  )

  switch (phase) {
    case 'creating':
      body = 'Starting the cloud session. Answer anything Claude asks in the terminal below; this tab switches to claude.ai once the session exists.'
      break
    case 'create-failed':
      tone = 'danger'
      body = (
        <>
          <span className="block whitespace-pre-wrap font-mono text-[10.5px]">
            {error ?? 'Claude did not create a cloud session.'}
          </span>
          {mayExist ? (
            <span className="mt-1 block">
              Claude was stopped after sending the request, so the session may exist anyway. Check claude.ai/code before retrying.
            </span>
          ) : null}
          <span className="mt-1 block text-text-muted">The worktree and branch are kept.</span>
        </>
      )
      actions = createActions('Retry')
      break
    case 'create-interrupted':
      body =
        'This cloud session was never confirmed: the app closed before Claude reported it. If it started, it is listed on claude.ai/code. Otherwise start it again.'
      actions = createActions('Retry start')
      break
    case 'teleport-blocked':
      tone = 'danger'
      body = (
        <>
          The worktree has uncommitted changes, so it can't be teleported into. Commit or discard them, then try again
          {dirtyFiles && dirtyFiles.length > 0 ? (
            <>
              :{' '}
              <code className="font-mono text-[10.5px]">
                {dirtyFiles.slice(0, 5).join(', ')}
                {dirtyFiles.length > 5 ? ` and ${dirtyFiles.length - 5} more` : ''}
              </code>
            </>
          ) : (
            '.'
          )}
        </>
      )
      break
    case 'teleport-ended':
      body = 'The local Claude session exited. Its conversation is on this machine now.'
      actions = onOpenLocally ? (
        <button type="button" onClick={onOpenLocally} className={BAR_BTN}>
          Continue as local agent
        </button>
      ) : null
      break
    case 'error':
      tone = 'danger'
      body = error ?? 'Something went wrong with the cloud session.'
      actions = (
        <>
          <button type="button" onClick={onDismissError} className={BAR_BTN}>
            Dismiss
          </button>
          {openBtn}
        </>
      )
      break
    default:
      return null
  }

  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'flex shrink-0 items-center gap-2 border-b px-3! py-1.5! text-[11.5px]',
        tone === 'danger' ? 'border-danger/40 bg-danger/10 text-text' : 'border-border bg-bg-secondary text-text-muted'
      )}
    >
      <span className="min-w-0 flex-1">{body}</span>
      {actions}
    </div>
  )
}
