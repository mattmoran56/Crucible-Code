// A /btw side question, in a sheet that slides up from the bottom over the
// composer. The fork is the conversation copied as it stood; its answer is
// drawn by the same Rows as the conversation, and nothing it says goes back.

import React, { useEffect, useMemo, useRef } from 'react'
import type { VisualAgentFork } from '../../../shared/visual-agent'
import { cn } from '../../lib/cn'
import { Close, Spinner, StopSquare } from './icons'
import { Rows, StatusDot, THREAD_STATUS } from './parts'
import { useLatched } from './SubagentTray'
import { asideOf, buildTranscript } from './transcript'

const noop = (): void => undefined

export function ForkSheet({
  fork,
  onStop,
  onClose,
}: {
  /** The fork to show, or null when closed. */
  fork: VisualAgentFork | null
  onStop: (forkId: string) => void
  onClose: () => void
}) {
  const open = fork !== null
  const shown = useLatched(fork)
  const frame = useRef<HTMLDivElement>(null)
  const transcript = useMemo(() => buildTranscript(shown?.events ?? []), [shown?.events])
  const aside = shown ? asideOf(shown) : null
  const running = aside?.status === 'running'

  useEffect(() => {
    if (open) frame.current?.focus()
  }, [open, fork?.id])

  return (
    <div
      ref={frame}
      tabIndex={-1}
      role="dialog"
      aria-hidden={!open}
      aria-label={aside ? `Side question: ${aside.question}` : 'Side question'}
      inert={!open}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        onClose()
      }}
      className={cn(
        'absolute inset-x-0 bottom-0 z-30 flex max-h-[70%] flex-col rounded-t-xl border-t border-accent/40 bg-bg-secondary shadow-[0_-12px_32px_rgba(0,0,0,0.25)] outline-none',
        'transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none',
        open ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-full opacity-0',
      )}
    >
      {shown && aside ? (
        <>
          <div className="flex flex-wrap items-center gap-2 px-3.5! pt-2.5!">
            <span className="text-accent" aria-hidden="true">
              ✦
            </span>
            <span className="font-mono text-[12px] font-medium text-text">btw</span>
            <span className={cn('flex items-center gap-1 text-[11px]', THREAD_STATUS[aside.status].text)}>
              <StatusDot status={aside.status} />
              {THREAD_STATUS[aside.status].word}
            </span>
            {running ? (
              <button
                type="button"
                onClick={() => onStop(shown.id)}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2! py-0.5! text-[11px] text-text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <StopSquare size={10} /> Stop
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="ml-auto! inline-flex items-center gap-1 rounded-md border border-border px-2! py-0.5! text-[11px] text-text hover:bg-bg-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Close size={10} /> Back to conversation
            </button>
          </div>
          <p className="px-3.5! pt-1.5! text-[12.5px] font-medium leading-relaxed text-text">{aside.question}</p>

          <div role="log" aria-label={`Answer to: ${aside.question}`} className="min-h-[4rem] flex-1 overflow-y-auto px-3.5! py-2.5!">
            {transcript.main.rows.length ? (
              <Rows rows={transcript.main.rows} ctx={{ threads: transcript.threads, onFocusChip: noop, running }} />
            ) : (
              <p className="flex items-center gap-2 text-[12px] text-text-muted">
                {running ? (
                  <>
                    <Spinner /> Answering from the conversation so far…
                  </>
                ) : (
                  'This side question said nothing.'
                )}
              </p>
            )}
          </div>

          <p className="border-t border-border px-3.5! py-1.5! text-[11px] leading-relaxed text-text-muted">
            Forked from the conversation as it stood. Nothing it says goes back into it, and it has no tools.
          </p>
        </>
      ) : null}
    </div>
  )
}
