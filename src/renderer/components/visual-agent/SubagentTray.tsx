// Sub-agents live in a tray under the conversation, one pill each, and open in
// a sheet that slides in from the right — never spliced into the thread that
// started them. Nested sub-agents are reached through the sheet's own tray,
// with a breadcrumb back up.

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '../../lib/cn'
import { ChevronLeft, Close, Spinner } from './icons'
import { Rows, StatusDot, THREAD_STATUS, type RowsContext } from './parts'
import type { Thread } from './transcript'

/** Keeps the last non-null value around while a sheet animates closed. */
export function useLatched<T>(value: T | null, ms = 200): T | null {
  const [held, setHeld] = useState<T | null>(value)
  useEffect(() => {
    if (value !== null) {
      setHeld(value)
      return
    }
    const timer = setTimeout(() => setHeld(null), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return value ?? held
}

/** Registry of tray pills, so a SubagentRef in the thread can move focus to its pill. */
export function useChips() {
  const chips = useRef(new Map<string, HTMLButtonElement>())
  const register = useCallback((id: string, element: HTMLButtonElement | null): void => {
    if (element) chips.current.set(id, element)
    else chips.current.delete(id)
  }, [])
  const focus = useCallback((id: string): void => {
    const chip = chips.current.get(id)
    if (!chip) return
    chip.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    chip.focus()
  }, [])
  return { register, focus }
}

function Chip({
  thread,
  open,
  onOpen,
  register,
}: {
  thread: Thread
  open: boolean
  onOpen: () => void
  register: (id: string, element: HTMLButtonElement | null) => void
}) {
  const status = THREAD_STATUS[thread.status]
  const name = thread.tool || 'subagent'
  const steps = `${thread.steps} ${thread.steps === 1 ? 'step' : 'steps'}`
  return (
    <button
      type="button"
      ref={(element) => register(thread.id, element)}
      onClick={onOpen}
      aria-pressed={open}
      aria-label={`${name}${thread.brief ? ` — ${thread.brief}` : ''} (${status.word}, ${steps})`}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border bg-bg px-2.5! py-[3px]! text-[11px] transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        thread.status === 'failed' ? 'border-danger/50' : thread.status === 'running' ? 'border-accent/50' : 'border-border',
        open ? 'bg-accent/15 text-text' : 'text-text-muted hover:text-text',
      )}
    >
      {thread.status === 'running' ? <Spinner className="size-2.5 text-accent" /> : <StatusDot status={thread.status} />}
      <span aria-hidden="true" className="max-w-[26ch] truncate">
        <span className="font-mono text-text">{name}</span>
        {thread.brief ? ` · ${thread.brief}` : ''}
      </span>
      <span aria-hidden="true" className="tabular-nums opacity-70">
        {thread.steps}
      </span>
    </button>
  )
}

export function SubagentTray({
  ids,
  threads,
  openId,
  onOpen,
  register,
}: {
  ids: string[]
  threads: Map<string, Thread>
  openId: string | null
  onOpen: (id: string) => void
  register: (id: string, element: HTMLButtonElement | null) => void
}) {
  if (!ids.length) return null
  return (
    <div
      role="group"
      aria-label="Subagents"
      className="flex shrink-0 items-center gap-2 overflow-x-auto border-t border-dashed border-border bg-bg-secondary/50 px-3! py-1.5!"
    >
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">Subagents</span>
      {ids.map((id) => {
        const thread = threads.get(id)
        return thread ? (
          <Chip key={id} thread={thread} open={openId === id} onOpen={() => onOpen(id)} register={register} />
        ) : null
      })}
    </div>
  )
}

/** The right-hand sheet showing one sub-agent's own conversation. */
export function SubagentSheet({
  open,
  path,
  threads,
  ctx,
  onPath,
  onClose,
}: {
  open: boolean
  path: string[]
  threads: Map<string, Thread>
  /** Row context from the panel (asks, answering…) — onFocusChip is replaced here. */
  ctx: Omit<RowsContext, 'threads' | 'onFocusChip'>
  onPath: (next: string[]) => void
  onClose: () => void
}) {
  const frame = useRef<HTMLDivElement>(null)
  const shown = useLatched(open && path.length ? path : null)
  const tipId = shown?.[shown.length - 1]
  const thread = tipId ? threads.get(tipId) : undefined
  const { register, focus } = useChips()

  useEffect(() => {
    if (open) frame.current?.focus()
  }, [open, tipId])

  return (
    <div
      ref={frame}
      tabIndex={-1}
      role="dialog"
      aria-hidden={!open}
      aria-label={thread ? `${thread.tool || 'subagent'} transcript` : 'Subagent transcript'}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        onClose()
      }}
      className={cn(
        'absolute inset-y-0 right-0 z-20 flex w-full max-w-[560px] flex-col border-l border-border bg-bg shadow-2xl outline-none',
        'transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none',
        open ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-full opacity-0',
      )}
      inert={!open}
    >
      {thread && shown ? (
        <>
          <header className="shrink-0 border-b border-border bg-bg-secondary px-3! py-2!">
            <div className="flex items-center gap-2">
              {shown.length > 1 ? (
                <button
                  type="button"
                  aria-label="Back to the sub-agent that started this one"
                  onClick={() => onPath(shown.slice(0, -1))}
                  className="grid size-6 place-items-center rounded text-text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <ChevronLeft />
                </button>
              ) : null}
              <span className="min-w-0 truncate font-mono text-[12px] font-medium text-text">{thread.tool || 'subagent'}</span>
              <span className={cn('flex shrink-0 items-center gap-1 text-[11px]', THREAD_STATUS[thread.status].text)}>
                <StatusDot status={thread.status} />
                {THREAD_STATUS[thread.status].word}
              </span>
              <span className="shrink-0 text-[11px] text-text-muted">
                {thread.steps} {thread.steps === 1 ? 'step' : 'steps'}
              </span>
              <button
                type="button"
                aria-label="Close this sub-agent"
                onClick={onClose}
                className="ml-auto! grid size-6 shrink-0 place-items-center rounded text-text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <Close />
              </button>
            </div>
            <nav aria-label="Breadcrumb" className="mt-1! flex flex-wrap items-center gap-1 text-[11px] text-text-muted">
              <button
                type="button"
                onClick={onClose}
                className="rounded px-1! hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Conversation
              </button>
              {shown.map((id, index) => (
                <span key={id} className="flex min-w-0 items-center gap-1">
                  <span aria-hidden="true">/</span>
                  {index < shown.length - 1 ? (
                    <button
                      type="button"
                      onClick={() => onPath(shown.slice(0, index + 1))}
                      className="rounded px-1! font-mono hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      {threads.get(id)?.tool || 'subagent'}
                    </button>
                  ) : (
                    <span aria-current="page" className="min-w-0 truncate px-1! text-text">
                      {thread.brief || thread.tool}
                    </span>
                  )}
                </span>
              ))}
            </nav>
          </header>

          <div role="log" aria-label={`${thread.tool || 'subagent'} transcript`} className="min-h-0 flex-1 overflow-y-auto px-4! py-3!">
            {thread.rows.length ? (
              <Rows
                rows={thread.rows}
                ctx={{ ...ctx, threads, onFocusChip: focus, running: thread.status === 'running' }}
              />
            ) : (
              <p className="flex items-center gap-2 text-[12px] text-text-muted">
                {thread.status === 'running' ? <Spinner /> : null}
                This sub-agent has not said anything yet.
              </p>
            )}
          </div>
          <SubagentTray
            ids={thread.children}
            threads={threads}
            openId={null}
            onOpen={(id) => onPath([...shown, id])}
            register={register}
          />
        </>
      ) : null}
    </div>
  )
}
