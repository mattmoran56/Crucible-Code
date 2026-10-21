// The Agent tab for a cloud session: a slim toolbar (styled like the visual
// agent's session bar) over the embedded claude.ai/code session page — and,
// once teleported, the terminal the session came down into.

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
        ) : !teleported ? (
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
      />
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
}: {
  phase: CloudAgentPhase
  error?: string | null
  dirtyFiles?: string[]
  onOpenInBrowser?: () => void
  onDismissError: () => void
  onOpenLocally?: () => void
}) {
  let tone: 'danger' | 'info' = 'info'
  let body: React.ReactNode = null
  let actions: React.ReactNode = null
  const openBtn = onOpenInBrowser ? (
    <button type="button" onClick={onOpenInBrowser} className={BAR_BTN}>
      <ExternalIcon size={11} /> Open in browser
    </button>
  ) : null

  switch (phase) {
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
