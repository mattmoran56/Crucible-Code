// The pieces one row of a conversation can be. A row draws what happened and
// never what it means for the run — connection state, model and which sheet
// is open are the panel's business. Ported from Jef's `parts.tsx`.

import React, { useState } from 'react'
import { cn } from '../../lib/cn'
import { AskCard, type AskDecide } from './AskCard'
import { ChevronRight, Fold, Sparkle, Spinner } from './icons'
import { Markdown } from './Markdown'
import { ToolCard, ToolGroup } from './ToolCard'
import {
  costOf,
  oneLine,
  piecesOf,
  spanOf,
  tokensOf,
  visibleRows,
  withAsides,
  type Aside,
  type EventOf,
  type Piece,
  type Row,
  type Thread,
  type ThreadStatus,
} from './transcript'

export const THREAD_STATUS: Record<ThreadStatus, { dot: string; text: string; word: string }> = {
  running: { dot: 'bg-accent', text: 'text-accent', word: 'working' },
  done: { dot: 'bg-success', text: 'text-success', word: 'finished' },
  failed: { dot: 'bg-danger', text: 'text-danger', word: 'failed' },
}

export function StatusDot({ status, className }: { status: ThreadStatus; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block size-1.5 shrink-0 rounded-full',
        THREAD_STATUS[status].dot,
        status === 'running' && 'animate-pulse motion-reduce:animate-none',
        className,
      )}
    />
  )
}

/** Prose from either side. Only the assistant's is markdown; the person's is what they typed. */
export function TextBubble({ event }: { event: EventOf<'text'> }) {
  if (event.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-[12px] rounded-br-[4px] border border-accent/25 bg-accent/12 px-3! py-2! text-[13px] leading-relaxed text-text">
          {event.text}
        </div>
      </div>
    )
  }
  return <Markdown text={event.text} />
}

/** The assistant's message as it streams, with a caret. */
export function StreamingText({ text }: { text: string }) {
  return (
    <div aria-live="off" aria-busy="true">
      <Markdown text={text}>
        <span
          aria-hidden="true"
          className="-mt-2! inline-block h-[1.05em] w-[0.5em] translate-y-[2px] animate-pulse bg-accent/80 motion-reduce:animate-none"
        />
      </Markdown>
    </div>
  )
}

export function Thinking({ event, live = false }: { event: EventOf<'thinking'>; live?: boolean }) {
  const [open, setOpen] = useState(false)
  const has = event.text.trim() !== ''
  if (!has) {
    return (
      <p className="flex items-center gap-1.5 text-[12px] italic text-text-muted">
        <Sparkle size={11} />
        {live ? 'thinking…' : 'thought about it'}
      </p>
    )
  }
  return (
    <div className="text-[12px] italic text-text-muted">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className="inline-flex items-center gap-1.5 rounded px-1! py-0.5! hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <ChevronRight size={11} className={cn('transition-transform', open && 'rotate-90')} />
        <Sparkle size={11} />
        {live ? 'thinking…' : 'thinking'}
      </button>
      {open ? (
        <p className="mt-1! whitespace-pre-wrap break-words border-l border-border pl-3! leading-relaxed">{event.text}</p>
      ) : null}
    </div>
  )
}

/** Something Claude Code added under the person's role, folded to one line. */
export function NoteMark({ event }: { event: EventOf<'note'> }) {
  const [open, setOpen] = useState(false)
  const has = event.text.trim() !== ''
  return (
    <div className="text-[12px] text-text-muted">
      <button
        type="button"
        aria-expanded={has ? open : undefined}
        disabled={!has}
        onClick={() => setOpen((was) => !was)}
        className="inline-flex max-w-full items-center gap-1.5 rounded px-1! py-0.5! enabled:hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {has ? <ChevronRight size={11} className={cn('shrink-0 transition-transform', open && 'rotate-90')} /> : null}
        <Fold size={11} className="shrink-0" />
        <span className="shrink-0 text-[10px] uppercase tracking-wide opacity-80">{event.source}</span>
        <span className="truncate">{event.label}</span>
      </button>
      {open ? (
        <pre className="mt-1! max-h-80 overflow-auto whitespace-pre-wrap break-words border-l border-border pl-3! font-mono text-[11px] leading-relaxed">
          {event.text}
        </pre>
      ) : null}
    </div>
  )
}

/** Where a sub-agent was started. Clicking moves focus to its pill in the tray. */
export function SubagentRef({ thread, onFocusChip }: { thread: Thread; onFocusChip: () => void }) {
  return (
    <button
      type="button"
      onClick={onFocusChip}
      title="Show this sub-agent in the tray below"
      className="inline-flex max-w-full items-center gap-2 rounded-full border border-dashed border-accent/50 bg-accent/8 px-2.5! py-1! text-left text-[11.5px] text-text-muted hover:bg-accent/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <Sparkle size={11} className="shrink-0 text-accent" />
      <span className="shrink-0 font-mono text-[11px] text-text">{thread.tool || 'subagent'}</span>
      {thread.brief ? <span className="min-w-0 truncate">{thread.brief}</span> : null}
      <StatusDot status={thread.status} />
      <span className="shrink-0">{THREAD_STATUS[thread.status].word}</span>
    </button>
  )
}

/** Where a /btw side question was asked. Clicking reopens the fork sheet. */
export function AsideRef({ aside, onOpen }: { aside: Aside; onOpen: () => void }) {
  const status = THREAD_STATUS[aside.status]
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Side question asked here: ${aside.question} (${status.word})`}
      className="inline-flex max-w-full items-center gap-2 rounded-full border border-dashed border-border bg-bg-secondary px-2.5! py-1! text-left text-[11.5px] text-text-muted hover:border-accent/60 hover:bg-accent/8 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <span className="shrink-0 text-accent">✦</span>
      <span className="shrink-0 font-mono text-[11px] text-text">btw</span>
      <span className="min-w-0 truncate">{oneLine(aside.question, 60)}</span>
      <StatusDot status={aside.status} />
      <span className="shrink-0">{aside.status === 'running' ? 'asking…' : 'read the answer'}</span>
    </button>
  )
}

function LooseResult({ event }: { event: EventOf<'tool-result'> }) {
  return (
    <div className="w-full rounded-md border border-border bg-bg-secondary px-3! py-2!">
      <p className="text-[11px] text-text-muted">A result for a tool call this panel did not see</p>
      <pre className={cn('mt-1.5! max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px]', event.ok ? 'text-text-muted' : 'text-danger')}>
        {event.text}
      </pre>
    </div>
  )
}

function SessionNote({ event }: { event: EventOf<'session'> }) {
  if (!event.mcpFailed.length) return null
  return (
    <p className="w-full rounded-md border border-danger/40 bg-danger/10 px-3! py-2! text-[12px] text-danger">
      {event.mcpFailed.join(', ')} — {event.mcpFailed.length === 1 ? 'this MCP server' : 'these MCP servers'} failed to
      start, so none of {event.mcpFailed.length === 1 ? 'its' : 'their'} tools are available in this session.
    </p>
  )
}

function ResultFoot({ event }: { event: EventOf<'result'> }) {
  if (event.ok) return null
  const parts = [costOf(event.costUsd), spanOf(event.durationMs)].filter(Boolean)
  return (
    <div className="flex flex-col gap-1 rounded-md border border-danger/40 bg-danger/8 px-3! py-2! text-[12px] text-danger">
      <p className="flex flex-wrap gap-x-3">
        <span className="font-medium">The turn did not finish</span>
        {parts.map((part) => (
          <span key={part} className="text-danger/80">
            {part}
          </span>
        ))}
      </p>
      {event.text ? <p className="whitespace-pre-wrap text-danger/90">{event.text}</p> : null}
    </div>
  )
}

function CompactionMark({ event }: { event: EventOf<'compacted'> }) {
  const before = typeof event.tokensBefore === 'number' ? tokensOf(event.tokensBefore) : null
  const why = event.trigger === 'manual' ? 'You asked for it' : event.trigger === 'auto' ? 'The context had filled up' : null
  return (
    <div className="flex flex-col items-center gap-1 py-1! text-text-muted">
      <div className="flex w-full items-center gap-3">
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
        <span
          className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border bg-bg-secondary px-2.5! py-1! text-[11px]"
          {...(why ? { title: why } : {})}
        >
          <Fold size={11} />
          Earlier history was summarised
          {before ? <span className="tabular-nums">· from {before} tokens</span> : null}
        </span>
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
      </div>
      <p className="text-center text-[11px]">Claude keeps a summary of everything above this line, not the words themselves.</p>
    </div>
  )
}

function ErrorNote({ event }: { event: EventOf<'error'> }) {
  return (
    <p role="alert" className="w-full rounded-md border border-danger/40 bg-danger/10 px-3! py-2! text-[12.5px] text-danger">
      {event.message}
    </p>
  )
}

function RetryNote({ event }: { event: EventOf<'retry'> }) {
  return (
    <p className="flex items-center gap-2 text-[11.5px] text-text-muted">
      <Spinner />
      Retrying ({event.attempt}/{event.max}) in {spanOf(event.delayMs) || 'a moment'} — {event.reason}
    </p>
  )
}

export interface RowsContext {
  threads: Map<string, Thread>
  onFocusChip: (threadId: string) => void
  /** Whether this thread's turn is still going (makes the last thinking row live). */
  running?: boolean
  asides?: readonly Aside[]
  onOpenAside?: (id: string) => void
  /** Ask ids still answerable. */
  pendingAsks?: ReadonlySet<string>
  answering?: string | null
  onDecide?: AskDecide
}

const EMPTY_SET: ReadonlySet<string> = new Set()

function RowView({ row, live, ctx }: { row: Row; live: boolean; ctx: RowsContext }) {
  const event = row.event
  switch (event.kind) {
    case 'text':
      return <TextBubble event={event} />
    case 'note':
      return <NoteMark event={event} />
    case 'thinking':
      return <Thinking event={event} live={live} />
    case 'tool': {
      const spawned = row.spawned ? ctx.threads.get(row.spawned) : undefined
      return spawned ? (
        <SubagentRef thread={spawned} onFocusChip={() => ctx.onFocusChip(spawned.id)} />
      ) : (
        <ToolCard call={event} result={row.result} />
      )
    }
    case 'tool-result':
      return <LooseResult event={event} />
    case 'ask':
      return (
        <AskCard
          event={event}
          decided={row.decided}
          pending={!row.decided && (ctx.pendingAsks ?? EMPTY_SET).has(event.id)}
          busy={ctx.answering === event.id}
          onDecide={ctx.onDecide}
        />
      )
    case 'ask-result':
      return (
        <p className="text-[11.5px] text-text-muted">
          A permission request was {event.decision === 'deny' ? 'denied' : 'allowed'} before this panel opened
        </p>
      )
    case 'session':
      return <SessionNote event={event} />
    case 'result':
      return <ResultFoot event={event} />
    case 'compacted':
      return <CompactionMark event={event} />
    case 'error':
      return <ErrorNote event={event} />
    case 'retry':
      return <RetryNote event={event} />
  }
}

const quiet = (piece: Piece): boolean =>
  piece.kind === 'tools' ||
  piece.kind === 'aside' ||
  piece.row.event.kind === 'tool' ||
  piece.row.event.kind === 'tool-result' ||
  piece.row.event.kind === 'retry' ||
  piece.row.event.kind === 'note' ||
  piece.row.event.kind === 'thinking'

const keyOf = (piece: Piece, index: number): string => {
  if (piece.kind === 'aside') return `a${piece.aside.id}`
  if (piece.kind === 'tools') return `t${piece.rows[0]?.key ?? index}`
  return piece.row.key
}

/** One conversation's rows, folded and spaced: air around prose, the machinery closes up. */
export function Rows({ rows, ctx, tail }: { rows: Row[]; ctx: RowsContext; tail?: React.ReactNode }) {
  const pieces = withAsides(piecesOf(visibleRows(rows)), ctx.asides ?? [])
  return (
    <div className="flex flex-col">
      {pieces.map((piece, index) => {
        const previous = pieces[index - 1]
        const close = index > 0 && quiet(piece) && previous !== undefined && quiet(previous)
        return (
          <div
            key={keyOf(piece, index)}
            className={cn(
              'min-w-0 [contain-intrinsic-size:auto_48px] [content-visibility:auto]',
              index > 0 && (close ? 'mt-1.5!' : 'mt-3.5!'),
            )}
          >
            {piece.kind === 'aside' ? (
              <AsideRef aside={piece.aside} onOpen={() => ctx.onOpenAside?.(piece.aside.id)} />
            ) : piece.kind === 'tools' ? (
              <ToolGroup rows={piece.rows} />
            ) : (
              <RowView row={piece.row} live={!!ctx.running && index === pieces.length - 1} ctx={ctx} />
            )}
          </div>
        )
      })}
      {tail ? <div className={cn(pieces.length > 0 && 'mt-3.5!')}>{tail}</div> : null}
    </div>
  )
}
