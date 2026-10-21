// The Agent tab for a cloud session: a slim toolbar (styled like the visual
// agent's session bar) over an embedded terminal that is attached to the
// Claude Code on the web session — and, once teleported, the terminal the
// session came down into.

import React, { useState } from 'react'
import type { Session } from '../../../shared/types'
import { shortCloudId } from '../../../shared/cloud-session'
import { cn } from '../../lib/cn'
import { TerminalView } from '../terminal/TerminalView'
import { Spinner } from '../visual-agent/icons'
import { CloudIcon, ExternalIcon, TeleportIcon } from './icons'

export type CloudAgentPhase =
  /** Spawning the attach terminal. */
  | 'attaching'
  /** `claude --cloud <id>` is running in the terminal. */
  | 'attached'
  /** Claude Code says attaching is not enabled for this account. */
  | 'attach-unavailable'
  /** The attach terminal exited. */
  | 'attach-ended'
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
  /** The PTY shown below the bar (attach or teleport), if any. */
  terminalId: string | null
  error?: string | null
  dirtyFiles?: string[]
  onOpenInBrowser: () => void
  /** Called once the user has confirmed. */
  onTeleport: () => void
  onReattach: () => void
  /** Queue a follow-up via `claude -p --cloud <id>` (fallback when attach is unavailable). */
  onSendFollowUp?: (message: string) => Promise<void>
  /** After the teleported session ends: reopen the Agent tab as a local visual agent. */
  onOpenLocally?: () => void
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
  onReattach,
  onSendFollowUp,
  onOpenLocally,
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
        onReattach={onReattach}
        onOpenLocally={onOpenLocally}
      />

      <div className="relative min-h-0 flex-1">
        {terminalId ? (
          <TerminalView terminalId={terminalId} sessionId={session.id} sessionName={session.name} visible={visible} />
        ) : phase === 'attaching' ? (
          <p className="absolute inset-0 m-auto! flex items-center justify-center gap-2 text-[12.5px] text-text-muted">
            <Spinner className="text-accent" /> Attaching to the cloud session…
          </p>
        ) : null}
      </div>

      {onSendFollowUp && (phase === 'attach-unavailable' || phase === 'attach-ended') ? (
        <FollowUp onSend={onSendFollowUp} />
      ) : null}
    </div>
  )
}

function PhaseLabel({ phase }: { phase: CloudAgentPhase }) {
  const text: Partial<Record<CloudAgentPhase, string>> = {
    attaching: 'attaching…',
    attached: 'watching',
    'attach-ended': 'detached',
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
  onReattach,
  onOpenLocally,
}: {
  phase: CloudAgentPhase
  error?: string | null
  dirtyFiles?: string[]
  onOpenInBrowser?: () => void
  onReattach: () => void
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
    case 'attach-unavailable':
      tone = 'danger'
      body = 'Attaching to a running cloud session is not enabled for your account. Watch it in the browser, or send follow-ups below.'
      actions = openBtn
      break
    case 'attach-ended':
      body = 'The attach terminal exited. The cloud session keeps running.'
      actions = (
        <>
          <button type="button" onClick={onReattach} className={BAR_BTN}>
            Reattach
          </button>
          {openBtn}
        </>
      )
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
          <button type="button" onClick={onReattach} className={BAR_BTN}>
            Retry
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

function FollowUp({ onSend }: { onSend: (message: string) => Promise<void> }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const message = text.trim()
    if (!message || sending) return
    setSending(true)
    setNote(null)
    try {
      await onSend(message)
      setText('')
      setNote('Sent to the cloud session.')
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err))
    } finally {
      setSending(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex shrink-0 items-center gap-2 border-t border-border bg-bg-secondary px-3! py-2!">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Send a follow-up to the cloud session…"
        aria-label="Follow-up message"
        className="min-w-0 flex-1 rounded-md border border-border bg-bg px-2! py-1! text-[12px] text-text focus:border-accent focus:outline-none"
      />
      <button type="submit" disabled={!text.trim() || sending} className={TELEPORT_BTN}>
        {sending ? <Spinner /> : null} Send
      </button>
      {note ? <span className="text-[11px] text-text-muted">{note}</span> : null}
    </form>
  )
}
