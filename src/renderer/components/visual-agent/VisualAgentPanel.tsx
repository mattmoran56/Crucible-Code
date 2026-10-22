// The Visual Agent: Claude Code as a conversation rather than a terminal.
//
// Layout, top to bottom: a slim session bar, the conversation log (with the
// sub-agent sheet sliding in over it from the right), the live turn status,
// the sub-agent tray, and the composer (with the /btw fork sheet sliding up
// over it from the bottom).

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { VisualAgentRunState, VisualAgentSnapshot, VisualAgentStartOptions } from '../../../shared/visual-agent'
import { cn } from '../../lib/cn'
import {
  EMPTY_VISUAL_AGENT_UI,
  emptySnapshot,
  isAskPending,
  useVisualAgentStore,
} from '../../stores/visualAgentStore'
import { sessionCommands } from './commands'
import { Composer } from './Composer'
import { useComposerFocus } from './composerFocus'
import { ForkSheet } from './ForkSheet'
import { Close, Power, Restart, Spinner, StopSquare } from './icons'
import { modelLabel } from './ModelPicker'
import { Rows, StreamingText, type RowsContext } from './parts'
import { SubagentSheet, SubagentTray, useChips } from './SubagentTray'
import { asideOf, buildTranscript, clockOf, costOf, tokensOf } from './transcript'
import './visual-agent.css'

export interface VisualAgentPanelProps {
  agentId: string
  startOptions: VisualAgentStartOptions
  visible: boolean
}

const STATE: Record<VisualAgentRunState, { word: string; dot: string; pulse?: boolean }> = {
  starting: { word: 'Starting', dot: 'bg-text-muted', pulse: true },
  running: { word: 'Working', dot: 'bg-accent', pulse: true },
  idle: { word: 'Ready', dot: 'bg-success' },
  'needs-input': { word: 'Needs you', dot: 'bg-warning', pulse: true },
  done: { word: 'Ended', dot: 'bg-text-muted' },
  failed: { word: 'Failed', dot: 'bg-danger' },
}

const isLive = (state: VisualAgentRunState): boolean => state === 'running' || state === 'needs-input'

/** Session totals across finished turns. */
export const totalsOf = (snap: VisualAgentSnapshot): { cost: number | null; tokens: number } => {
  let cost: number | null = null
  let tokens = 0
  for (const event of snap.events) {
    if (event.kind !== 'result' || event.threadId !== 'main') continue
    if (event.costUsd !== null) cost = (cost ?? 0) + event.costUsd
    if (event.usage) tokens += event.usage.input + event.usage.output + event.usage.cacheRead + event.usage.cacheWrite
  }
  return { cost, tokens }
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  return now
}

/* --- session bar ----------------------------------------------------------- */

const BAR_BTN =
  'inline-flex items-center gap-1 rounded-md border border-transparent px-1.5! py-[2px]! text-[11px] text-text-muted transition-colors hover:border-border hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent'

function SessionBar({
  snap,
  onInterrupt,
  onEnd,
  onRestart,
}: {
  snap: VisualAgentSnapshot
  onInterrupt: () => void
  onEnd: () => void
  onRestart: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const state = STATE[snap.state]
  const { cost, tokens } = totalsOf(snap)
  const ended = snap.state === 'done' || snap.state === 'failed'

  return (
    <div className="flex h-8 shrink-0 items-center gap-2.5 border-b border-border bg-bg-secondary px-3! text-[11px]">
      <span className="flex items-center gap-1.5 font-medium text-text" role="status" aria-label={`Session ${state.word}`}>
        <span
          aria-hidden="true"
          className={cn('size-2 rounded-full', state.dot, state.pulse && 'animate-pulse motion-reduce:animate-none')}
        />
        {state.word}
      </span>
      <span className="text-text-muted" aria-hidden="true">
        ·
      </span>
      <span className="text-text-muted" title={snap.model}>
        {modelLabel(snap.model)}
      </span>
      {snap.claudeSessionId ? (
        <>
          <span className="text-text-muted" aria-hidden="true">
            ·
          </span>
          <code className="font-mono text-[10.5px] text-text-muted" title={`Claude session ${snap.claudeSessionId}`}>
            {snap.claudeSessionId.slice(0, 8)}
          </code>
        </>
      ) : null}
      {cost !== null || tokens > 0 ? (
        <span className="hidden tabular-nums text-text-muted sm:inline" title="Session total across finished turns">
          · {[costOf(cost), tokens ? `${tokensOf(tokens)} tok` : ''].filter(Boolean).join(' · ')}
        </span>
      ) : null}

      <span className="flex-1" />

      {isLive(snap.state) ? (
        <button type="button" onClick={onInterrupt} className={BAR_BTN} title="Stop this turn (Esc)">
          <StopSquare size={9} /> Stop turn
        </button>
      ) : null}
      {confirming ? (
        <span className="flex items-center gap-1" role="group" aria-label="Confirm ending the session">
          <span className="text-text">End session?</span>
          <button
            type="button"
            autoFocus
            onClick={() => {
              setConfirming(false)
              onEnd()
            }}
            className={cn(BAR_BTN, 'border-danger/50 text-danger hover:border-danger hover:text-danger')}
          >
            End
          </button>
          <button type="button" onClick={() => setConfirming(false)} className={BAR_BTN}>
            Cancel
          </button>
        </span>
      ) : (
        <>
          <button type="button" onClick={onRestart} className={BAR_BTN} title="Restart the claude process, resuming this conversation">
            <Restart size={11} /> Restart
          </button>
          {!ended ? (
            <button type="button" onClick={() => setConfirming(true)} className={BAR_BTN} title="End this Claude session">
              <Power size={11} /> End session
            </button>
          ) : null}
        </>
      )}
    </div>
  )
}

/* --- turn status ------------------------------------------------------------ */

function TurnStatus({ snap }: { snap: VisualAgentSnapshot }) {
  const live = isLive(snap.state)
  const now = useNow(live)
  if (!live) return null
  const started = snap.turnStartedAt ? Date.parse(snap.turnStartedAt) : NaN
  const elapsed = Number.isFinite(started) ? clockOf(now - started) : null
  const waiting = snap.state === 'needs-input'
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex shrink-0 items-center gap-2 border-t border-border px-3! py-1! text-[11px]',
        waiting ? 'bg-warning/10 text-warning' : 'text-text-muted',
      )}
    >
      {waiting ? <span aria-hidden="true" className="size-1.5 rounded-full bg-warning" /> : <Spinner className="size-2.5 text-accent" />}
      <span className={waiting ? 'font-medium' : 'text-text'}>{waiting ? 'Waiting for you' : 'Working'}</span>
      {elapsed ? <span className="tabular-nums">{elapsed}</span> : null}
      {snap.usage ? (
        <span className="tabular-nums">
          · {tokensOf(snap.usage.input)} in · {tokensOf(snap.usage.output)} out
        </span>
      ) : null}
    </div>
  )
}

/* --- the panel -------------------------------------------------------------- */

const STICK_PX = 40
/** How long after a wheel/touch/key/pointer on the log a scroll counts as the reader's. */
const USER_INTENT_MS = 1000

export function VisualAgentPanel({ agentId, startOptions, visible }: VisualAgentPanelProps) {
  const stored = useVisualAgentStore((s) => s.agents[agentId])
  const ui = useVisualAgentStore((s) => s.ui[agentId]) ?? EMPTY_VISUAL_AGENT_UI
  const error = useVisualAgentStore((s) => s.errors[agentId] ?? null)
  const actions = useVisualAgentStore.getState()

  const snap = useMemo(
    () => stored ?? emptySnapshot(agentId, startOptions.model),
    [stored, agentId, startOptions.model],
  )

  useEffect(() => {
    void useVisualAgentStore.getState().ensureStarted(startOptions)
    // Start options are read once per agent; later changes don't restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId])

  const transcript = useMemo(() => buildTranscript(snap.events), [snap.events])
  const asides = useMemo(() => snap.forks.map(asideOf), [snap.forks])
  const commands = useMemo(() => sessionCommands(snap.commands), [snap.commands])
  const pendingAsks = useMemo(() => {
    const ids = new Set<string>()
    for (const e of snap.events) if (e.kind === 'ask' && isAskPending(snap, e.id)) ids.add(e.id)
    return ids
  }, [snap])

  const setUi = useCallback((patch: Parameters<typeof actions.setUi>[1]) => actions.setUi(agentId, patch), [actions, agentId])

  const { register, focus: focusChip } = useChips()
  const root = useRef<HTMLDivElement>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  const log = useRef<HTMLDivElement>(null)
  const logContent = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const [behind, setBehind] = useState(false)

  const sheetOpen = ui.subagentPath.length > 0
  const openFork = ui.openForkId ? (snap.forks.find((f) => f.id === ui.openForkId) ?? null) : null

  const focus = useComposerFocus({
    composer,
    root,
    onCharacter: (c) => setUi({ draft: (useVisualAgentStore.getState().ui[agentId]?.draft ?? '') + c }),
    enabled: visible && !sheetOpen && !openFork,
  })

  // Follow the bottom only while the reader is already there.
  const partialText = snap.partial?.threadId === 'main' ? snap.partial.text : null
  useLayoutEffect(() => {
    const el = log.current
    if (!el) return
    if (stick.current) el.scrollTop = el.scrollHeight
    else setBehind(true)
  }, [snap.events.length, partialText, asides.length])

  useLayoutEffect(() => {
    if (!visible) return
    const el = log.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [visible])

  // Content also grows after it mounts (code highlighting, markdown, an ask
  // card) and the log shrinks when the tray or composer grows: keep the
  // bottom in view through those too while the reader is following.
  useEffect(() => {
    const el = log.current
    const content = logContent.current
    if (!el || !content || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight
    })
    observer.observe(el)
    observer.observe(content)
    return () => observer.disconnect()
  }, [])

  // Only the reader lets go of the bottom. Scroll events also come from the
  // browser (the log is re-laid out, moved or shown again and its scrollTop
  // resets), and those must not unpin it.
  const userIntentAt = useRef(0)
  const noteUserIntent = (): void => {
    userIntentAt.current = Date.now()
  }
  const onScroll = (): void => {
    const el = log.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_PX
    if (atBottom) {
      stick.current = true
      setBehind(false)
    } else if (stick.current && Date.now() - userIntentAt.current > USER_INTENT_MS) {
      el.scrollTop = el.scrollHeight
    } else {
      stick.current = false
    }
  }

  const jumpToLatest = (): void => {
    const el = log.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    stick.current = true
    setBehind(false)
  }

  const running = isLive(snap.state)
  const ended = snap.state === 'done' || snap.state === 'failed'

  const ctx: RowsContext = {
    threads: transcript.threads,
    onFocusChip: focusChip,
    running,
    asides,
    onOpenAside: (id) => setUi({ openForkId: id }),
    pendingAsks,
    answering: ui.answering,
    onDecide: (id, decision, answers) => void actions.answer(agentId, id, decision, answers),
  }

  const send = (text: string): void => {
    stick.current = true
    void actions.send(agentId, text)
  }

  const mainRows = transcript.main.rows
  const empty = mainRows.length === 0 && asides.length === 0 && !partialText

  return (
    <div
      ref={root}
      className={cn('relative flex min-h-0 flex-1 flex-col overflow-hidden bg-bg text-text', !visible && 'hidden')}
      onMouseDown={focus.onMouseDown}
      onClick={focus.onClick}
    >
      <SessionBar
        snap={snap}
        onInterrupt={() => void actions.interrupt(agentId)}
        onEnd={() => void actions.stop(agentId)}
        onRestart={() => void actions.restart(agentId)}
      />

      {error ? (
        <div role="alert" className="flex shrink-0 items-start gap-2 border-b border-danger/40 bg-danger/10 px-3! py-1.5! text-[12px] text-danger">
          <span className="min-w-0 flex-1 break-words">{error}</span>
          <button
            type="button"
            aria-label="Dismiss error"
            onClick={() => actions.clearError(agentId)}
            className="grid size-5 shrink-0 place-items-center rounded hover:bg-danger/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-danger"
          >
            <Close size={10} />
          </button>
        </div>
      ) : null}

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={log}
          role="log"
          aria-label="Conversation"
          aria-busy={running}
          onScroll={onScroll}
          onWheel={noteUserIntent}
          onTouchMove={noteUserIntent}
          onKeyDown={noteUserIntent}
          onPointerDown={noteUserIntent}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          <div ref={logContent} className="mx-auto! flex min-h-full w-full max-w-[920px] flex-col px-5! py-4!">
            {empty ? (
              <EmptyState snap={snap} cwd={startOptions.cwd} />
            ) : (
              <Rows rows={mainRows} ctx={ctx} tail={partialText ? <StreamingText text={partialText} /> : null} />
            )}
          </div>
        </div>

        {behind ? (
          <button
            type="button"
            onClick={jumpToLatest}
            className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full border border-border bg-bg-secondary px-3! py-1! text-[11px] text-text shadow-lg hover:border-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent animate-[va-rise_150ms_ease-out]"
          >
            ↓ Jump to latest
          </button>
        ) : null}

        <SubagentSheet
          open={sheetOpen}
          path={ui.subagentPath}
          threads={transcript.threads}
          ctx={{ pendingAsks, answering: ui.answering, onDecide: ctx.onDecide }}
          onPath={(next) => setUi({ subagentPath: next })}
          onClose={() => {
            const top = ui.subagentPath[0]
            setUi({ subagentPath: [] })
            if (top) requestAnimationFrame(() => focusChip(top))
          }}
        />
      </div>

      <TurnStatus snap={snap} />

      <SubagentTray
        ids={transcript.main.children}
        threads={transcript.threads}
        openId={ui.subagentPath[0] ?? null}
        onOpen={(id) => setUi({ subagentPath: ui.subagentPath[0] === id ? [] : [id] })}
        register={register}
      />

      <div className="relative shrink-0 border-t border-border">
        <Composer
          ref={composer}
          draft={ui.draft}
          onDraft={(draft) => setUi({ draft })}
          running={running}
          disabled={ended || snap.state === 'starting'}
          placeholder={ended ? 'This session has ended — Restart to continue' : snap.state === 'starting' ? 'Starting Claude…' : undefined}
          model={snap.model}
          onModel={(model) => void actions.setModel(agentId, model)}
          onSend={send}
          onFork={(question) => void actions.fork(agentId, question)}
          onInterrupt={() => void actions.interrupt(agentId)}
          onClear={() => void actions.restart(agentId, true)}
          commands={commands}
        />
      </div>

      <ForkSheet
        fork={openFork}
        onStop={(forkId) => void actions.forkStop(agentId, forkId)}
        onClose={() => {
          setUi({ openForkId: null })
          requestAnimationFrame(() => composer.current?.focus())
        }}
      />
    </div>
  )
}

function EmptyState({ snap, cwd }: { snap: VisualAgentSnapshot; cwd: string }) {
  return (
    <div className="m-auto! flex max-w-sm flex-col items-center gap-2 text-center">
      {snap.state === 'starting' ? (
        <p className="flex items-center gap-2 text-[12.5px] text-text-muted">
          <Spinner className="text-accent" /> Starting Claude…
        </p>
      ) : (
        <>
          <p className="text-[14px] font-medium text-text">What should Claude work on?</p>
          <p className="text-[12px] leading-relaxed text-text-muted">
            Claude runs in <code className="font-mono text-[11px] text-text">{cwd}</code>. Tool calls, diffs and
            sub-agents show up here as it works. Type <code className="font-mono text-[11px] text-text">/</code> for
            commands, or <code className="font-mono text-[11px] text-text">/btw</code> to ask something on the side.
          </p>
        </>
      )}
    </div>
  )
}

