// A /btw aside: a second conversation, forked from the main one as it stood,
// in a full-height panel that slides out from the right edge of the Agent
// tab. It has its own chat bar, so the aside can be carried on (each
// follow-up resumes the fork, never the main conversation) and then closed to
// go back to the main chat. Nothing it says goes back into the main one.
//
// AsideSplit lays the panel beside everything else in the tab. On the core
// Agent tab it wraps the link browser too, so an open browser sits between
// the main conversation and the aside.

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { VisualAgentEvent, VisualAgentFork } from '../../../shared/visual-agent'
import { cn } from '../../lib/cn'
import { EMPTY_VISUAL_AGENT_UI, useVisualAgentStore } from '../../stores/visualAgentStore'
import { CLOUD_WEB_LAYER_Z } from '../cloud/CloudWebPool'
import { Close, SendArrow, Spinner, StopSquare } from './icons'
import { Rows, StatusDot, THREAD_STATUS } from './parts'
import { useLatched } from './SubagentTray'
import { asideOf, buildTranscript } from './transcript'

/** How long the panel takes to slide in or out. */
export const ASIDE_SLIDE_MS = 200
export const DEFAULT_ASIDE_WIDTH = 420
export const MIN_ASIDE_WIDTH = 300
/** The aside never takes more than this share of the tab. */
const MAX_ASIDE_SHARE = 0.6
const WIDTH_STEP = 24
const MAX_INPUT_HEIGHT = 160

const noop = (): void => undefined

export const clampAsideWidth = (width: number, total: number): number => {
  const max = Math.max(MIN_ASIDE_WIDTH, total * MAX_ASIDE_SHARE)
  if (!Number.isFinite(width)) return DEFAULT_ASIDE_WIDTH
  return Math.round(Math.min(max, Math.max(MIN_ASIDE_WIDTH, width)))
}

/** The aside's conversation: the question that opened it, then everything since. */
export const asideEvents = (fork: VisualAgentFork): VisualAgentEvent[] => [
  {
    uuid: `${fork.id}:question`,
    seq: -1,
    threadId: 'main',
    at: fork.startedAt,
    kind: 'text',
    role: 'user',
    text: fork.question,
  },
  ...fork.events,
]

export interface AsideSplitProps {
  /** The visual agent whose asides open here. */
  agentId: string
  visible: boolean
  children: ReactNode
  /** Clicks on web links inside the aside (the Agent tab sends them to its link browser). */
  onLinkClickCapture?: (event: React.MouseEvent) => void
}

export function AsideSplit({ agentId, visible, children, onLinkClickCapture }: AsideSplitProps) {
  const openForkId = useVisualAgentStore((s) => s.ui[agentId]?.openForkId ?? null)
  const fork = useVisualAgentStore((s) =>
    openForkId ? (s.agents[agentId]?.forks.find((f) => f.id === openForkId) ?? null) : null,
  )
  const shownFork = useLatched(fork, ASIDE_SLIDE_MS)
  const container = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(DEFAULT_ASIDE_WIDTH)
  const [dragging, setDragging] = useState(false)

  // Slide in after a first frame at zero width; out by going back to zero.
  const [shown, setShown] = useState(false)
  const isOpen = fork !== null
  useEffect(() => {
    if (!isOpen) {
      setShown(false)
      return
    }
    const raf = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(raf)
  }, [isOpen])

  const close = useCallback(() => {
    useVisualAgentStore.getState().setUi(agentId, { openForkId: null })
    // Back to the main chat's composer.
    requestAnimationFrame(() =>
      container.current?.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message Claude"]')?.focus(),
    )
  }, [agentId])

  const total = container.current?.getBoundingClientRect().width ?? 0
  const open = isOpen && shown
  const asideWidth = open ? (total > 0 ? clampAsideWidth(width, total) : width) : 0

  return (
    <div ref={container} className={cn('relative flex min-h-0 min-w-0 flex-1', !visible && 'hidden')} data-testid="aside-split">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>

      {shownFork ? (
        <>
          {open ? <AsideDivider width={asideWidth} container={container} onWidth={setWidth} onDragging={setDragging} /> : null}
          <div
            className={cn(
              'relative flex min-h-0 shrink-0 flex-col overflow-hidden',
              !dragging && 'transition-[width] ease-out motion-reduce:transition-none',
            )}
            style={{ width: asideWidth, transitionDuration: `${ASIDE_SLIDE_MS}ms` }}
            onClickCapture={onLinkClickCapture}
          >
            <AsidePanel
              agentId={agentId}
              fork={shownFork}
              open={isOpen}
              width={Math.max(asideWidth, MIN_ASIDE_WIDTH)}
              onClose={close}
            />
          </div>
        </>
      ) : null}

      {dragging ? (
        // Webviews swallow pointer events: cover everything while dragging.
        <div className="fixed inset-0 cursor-col-resize" style={{ zIndex: CLOUD_WEB_LAYER_Z + 3 }} aria-hidden="true" />
      ) : null}
    </div>
  )
}

/* --- divider ---------------------------------------------------------------- */

function AsideDivider({
  width,
  container,
  onWidth,
  onDragging,
}: {
  width: number
  container: React.RefObject<HTMLDivElement | null>
  onWidth: (width: number) => void
  onDragging: (dragging: boolean) => void
}) {
  const onPointerDown = (e: React.PointerEvent): void => {
    if (e.button !== 0) return
    const box = container.current?.getBoundingClientRect()
    if (!box || box.width <= 0) return
    e.preventDefault()
    onDragging(true)
    const move = (ev: PointerEvent): void => onWidth(clampAsideWidth(box.right - ev.clientX, box.width))
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      onDragging(false)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const total = container.current?.getBoundingClientRect().width ?? 0
    // The aside is on the right: moving the divider left widens it.
    if (e.key === 'ArrowLeft') onWidth(clampAsideWidth(width + WIDTH_STEP, total))
    else if (e.key === 'ArrowRight') onWidth(clampAsideWidth(width - WIDTH_STEP, total))
    else if (e.key === 'Home' || e.key === 'Enter') onWidth(DEFAULT_ASIDE_WIDTH)
    else return
    e.preventDefault()
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the aside"
      aria-valuenow={Math.round(width)}
      aria-valuemin={MIN_ASIDE_WIDTH}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onDoubleClick={() => onWidth(DEFAULT_ASIDE_WIDTH)}
      onKeyDown={onKeyDown}
      className="group relative z-10 -mr-[3px]! w-[6px] shrink-0 cursor-col-resize focus:outline-none"
      data-testid="aside-divider"
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 bg-transparent transition-colors group-hover:bg-accent/60 group-focus-visible:bg-accent"
      />
    </div>
  )
}

/* --- the panel -------------------------------------------------------------- */

const HEAD_BTN =
  'inline-flex items-center gap-1 rounded-md border border-border px-2! py-0.5! text-[11px] text-text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent'

export function AsidePanel({
  agentId,
  fork,
  open,
  width,
  onClose,
}: {
  agentId: string
  fork: VisualAgentFork
  /** False while it slides away: it is drawn but takes no input. */
  open: boolean
  /** The width it lays out at, kept while the column slides so nothing reflows. */
  width: number
  onClose: () => void
}) {
  const actions = useVisualAgentStore.getState()
  const draft = useVisualAgentStore((s) => s.ui[agentId]?.asideDrafts?.[fork.id] ?? '')
  const events = useMemo(() => asideEvents(fork), [fork])
  const transcript = useMemo(() => buildTranscript(events), [events])
  const aside = asideOf(fork)
  const running = aside.status === 'running'
  const input = useRef<HTMLTextAreaElement>(null)
  const log = useRef<HTMLDivElement>(null)

  const setDraft = (text: string): void => {
    const drafts = useVisualAgentStore.getState().ui[agentId]?.asideDrafts ?? EMPTY_VISUAL_AGENT_UI.asideDrafts
    actions.setUi(agentId, { asideDrafts: { ...drafts, [fork.id]: text } })
  }

  useEffect(() => {
    if (open) input.current?.focus()
  }, [open, fork.id])

  // Follow the answer as it comes in.
  useLayoutEffect(() => {
    const el = log.current
    if (el) el.scrollTop = el.scrollHeight
  }, [events.length, fork.id])

  useLayoutEffect(() => {
    const el = input.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_HEIGHT)}px`
  }, [draft])

  const send = (): void => {
    const text = draft.trim()
    if (!text || running) return
    setDraft('')
    void actions.forkSend(agentId, fork.id, text)
  }

  return (
    <section
      role="complementary"
      aria-label={`Aside: ${aside.question}`}
      aria-hidden={!open}
      inert={!open}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return
        event.stopPropagation()
        onClose()
      }}
      className="flex h-full min-h-0 flex-col border-l-2 border-accent/50 bg-bg-secondary shadow-[-12px_0_32px_rgba(0,0,0,0.22)]"
      style={{ width }}
      data-testid="aside-panel"
    >
      <header className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-3! text-[11px]">
        <span className="text-accent" aria-hidden="true">
          ✦
        </span>
        <span className="font-medium text-text">Aside</span>
        <span className={cn('flex items-center gap-1', THREAD_STATUS[aside.status].text)}>
          <StatusDot status={aside.status} />
          {THREAD_STATUS[aside.status].word}
        </span>
        <span className="flex-1" />
        {running ? (
          <button type="button" onClick={() => void actions.forkStop(agentId, fork.id)} className={HEAD_BTN}>
            <StopSquare size={10} /> Stop
          </button>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          className="grid size-6 place-items-center rounded-md text-text-muted hover:bg-bg-tertiary hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          title="Close the aside and go back to the main chat (Esc)"
          aria-label="Close the aside"
        >
          <Close size={10} />
        </button>
      </header>

      <p className="shrink-0 border-b border-border px-3.5! py-1.5! text-[11px] leading-relaxed text-text-muted">
        Forked from the conversation as it stood. Nothing said here goes back into it, and the aside has no tools.
      </p>

      <div ref={log} role="log" aria-label={`Aside: ${aside.question}`} aria-busy={running} className="min-h-0 flex-1 overflow-y-auto px-3.5! py-3!">
        <div className="flex flex-col">
          <Rows rows={transcript.main.rows} ctx={{ threads: transcript.threads, onFocusChip: noop, running }} />
          {running ? (
            <p className="mt-2! flex items-center gap-2 text-[12px] text-text-muted">
              <Spinner /> Answering from the conversation so far…
            </p>
          ) : null}
        </div>
      </div>

      <div className="shrink-0 border-t border-border p-2!">
        <div className="flex items-end gap-2 rounded-lg border border-border bg-bg px-2.5! py-1.5! focus-within:border-accent/60">
          <textarea
            ref={input}
            rows={1}
            value={draft}
            aria-label="Follow up in the aside"
            placeholder={running ? 'Waiting for the answer…' : 'Follow up in the aside…'}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                send()
              }
            }}
            className="max-h-40 min-h-[22px] flex-1 resize-none bg-transparent text-[12.5px] leading-relaxed text-text outline-none placeholder:text-text-muted"
          />
          <button
            type="button"
            onClick={send}
            disabled={running || !draft.trim()}
            aria-label="Send in the aside"
            className="grid size-6 shrink-0 place-items-center rounded-md bg-accent text-bg transition-colors hover:bg-accent-hover disabled:opacity-40 disabled:hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <SendArrow size={11} />
          </button>
        </div>
        <p className="mt-1! px-1! text-[10.5px] text-text-muted">Enter to send · Shift+Enter for a new line · Esc to go back to the main chat</p>
      </div>
    </section>
  )
}
