// A permission question, and its answers. The only row that is not a record of
// something that happened: the turn is stopped on it, so it is drawn in the
// warning colour, which this app reserves for "waiting on you".

import React, { useState } from 'react'
import type { VisualAgentAskDecision } from '../../../shared/visual-agent'
import { cn } from '../../lib/cn'
import { Sparkle } from './icons'
import { oneLine, toolDigest, type AskEvent, type AskResultEvent } from './transcript'

export interface AskQuestion {
  question: string
  header: string
  multiSelect: boolean
  options: { label: string; description: string }[]
}

/** The questions an AskUserQuestion call carries, or null for any other tool. */
export const questionsOf = (event: AskEvent): AskQuestion[] | null => {
  if (event.tool !== 'AskUserQuestion') return null
  const input = event.input as { questions?: unknown } | null
  if (!input || !Array.isArray(input.questions)) return null
  return input.questions.flatMap((q): AskQuestion[] => {
    if (!q || typeof q !== 'object') return []
    const held = q as Record<string, unknown>
    if (typeof held.question !== 'string') return []
    const options = Array.isArray(held.options)
      ? held.options.flatMap((o) => {
          if (typeof o === 'string') return [{ label: o, description: '' }]
          if (!o || typeof o !== 'object') return []
          const opt = o as Record<string, unknown>
          return typeof opt.label === 'string'
            ? [{ label: opt.label, description: typeof opt.description === 'string' ? opt.description : '' }]
            : []
        })
      : []
    return [
      {
        question: held.question,
        header: typeof held.header === 'string' ? held.header : '',
        multiSelect: held.multiSelect === true,
        options,
      },
    ]
  })
}

export type AskDecide = (id: string, decision: VisualAgentAskDecision, answers?: Record<string, string>) => void

const DECIDED_WORD: Record<VisualAgentAskDecision, string> = {
  allow: 'Allowed once',
  always: 'Always allowed',
  deny: 'Denied',
}

const BTN =
  'rounded-md border text-[11.5px] font-medium px-2.5! py-1! transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50'

export function AskCard({
  event,
  decided,
  pending,
  busy = false,
  onDecide,
}: {
  event: AskEvent
  decided: AskResultEvent | null
  /** Whether the question can still be answered. */
  pending: boolean
  /** An answer is in flight. */
  busy?: boolean
  onDecide?: AskDecide
}) {
  const questions = questionsOf(event)
  const digest = questions ? '' : oneLine(toolDigest(event.input), 200)
  const settled = decided?.decision ?? null

  return (
    <div
      role={pending ? 'group' : undefined}
      aria-label={pending ? `Permission request for ${event.tool}` : undefined}
      className={cn(
        'w-full rounded-md border px-3.5! py-3! text-[12.5px] leading-relaxed',
        pending ? 'border-warning/70 bg-warning/10' : 'border-border bg-bg-secondary',
      )}
    >
      <p className={cn('flex flex-wrap items-center gap-1.5', pending ? 'text-text' : 'text-text-muted')}>
        <Sparkle size={12} className={pending ? 'text-warning' : 'text-text-muted'} />
        <span className="font-semibold">{pending ? 'Claude is waiting for you' : 'Claude asked to use'}</span>
        <span aria-hidden="true">·</span>
        <code className="font-mono text-[11.5px]">{event.tool}</code>
        {settled ? (
          <span
            className={cn(
              'ml-auto! rounded-full border px-2! text-[10.5px] font-medium',
              settled === 'deny' ? 'border-danger/40 text-danger' : 'border-success/40 text-success',
            )}
          >
            {DECIDED_WORD[settled]}
          </span>
        ) : !pending ? (
          <span className="ml-auto! text-[10.5px] text-text-muted">never answered</span>
        ) : null}
      </p>

      {event.description ? <p className="mt-1.5! text-text-muted">{event.description}</p> : null}
      {digest ? (
        <pre className="mt-1.5! overflow-auto whitespace-pre-wrap break-words rounded bg-bg px-2.5! py-1.5! font-mono text-[11px] text-text">
          {digest}
        </pre>
      ) : null}
      {event.reason ? <p className="mt-1.5! text-[11.5px] text-text-muted">{event.reason}</p> : null}

      {questions ? (
        <QuestionForm
          questions={questions}
          enabled={pending && !!onDecide && !busy}
          onSubmit={(answers) => onDecide?.(event.id, 'allow', answers)}
          onDeny={() => onDecide?.(event.id, 'deny')}
        />
      ) : pending && onDecide ? (
        <div className="mt-3! flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecide(event.id, 'allow')}
            className={cn(BTN, 'border-warning/70 bg-warning/15 text-text hover:bg-warning/25')}
          >
            Allow once
          </button>
          {event.canAlwaysAllow ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onDecide(event.id, 'always')}
              className={cn(BTN, 'border-border text-text hover:bg-bg-tertiary')}
            >
              Always allow
            </button>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecide(event.id, 'deny')}
            className={cn(BTN, 'border-danger/50 text-danger hover:bg-danger/10')}
          >
            Deny
          </button>
          {!event.canAlwaysAllow ? (
            <span className="text-[10.5px] text-text-muted">No standing rule covers this — it will ask again.</span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function QuestionForm({
  questions,
  enabled,
  onSubmit,
  onDeny,
}: {
  questions: AskQuestion[]
  enabled: boolean
  onSubmit: (answers: Record<string, string>) => void
  onDeny: () => void
}) {
  const [picked, setPicked] = useState<Record<string, string[]>>({})
  const [other, setOther] = useState<Record<string, string>>({})

  const toggle = (q: AskQuestion, label: string): void =>
    setPicked((was) => {
      const held = was[q.question] ?? []
      const next = q.multiSelect
        ? held.includes(label)
          ? held.filter((l) => l !== label)
          : [...held, label]
        : [label]
      return { ...was, [q.question]: next }
    })

  const answerOf = (q: AskQuestion): string =>
    [...(picked[q.question] ?? []), ...(other[q.question]?.trim() ? [other[q.question].trim()] : [])].join(', ')
  const complete = questions.every((q) => answerOf(q) !== '')

  return (
    <div className="mt-2.5! flex flex-col gap-3">
      {questions.map((q) => (
        <fieldset key={q.question} disabled={!enabled} className="flex flex-col gap-1.5">
          <legend className="text-[12.5px] font-medium text-text">
            {q.header ? <span className="mr-1.5! rounded bg-bg-tertiary px-1.5! text-[10px] uppercase tracking-wide text-text-muted">{q.header}</span> : null}
            {q.question}
          </legend>
          <div className="mt-1! flex flex-wrap gap-1.5" role={q.multiSelect ? 'group' : 'radiogroup'} aria-label={q.question}>
            {q.options.map((opt) => {
              const on = (picked[q.question] ?? []).includes(opt.label)
              return (
                <button
                  key={opt.label}
                  type="button"
                  role={q.multiSelect ? 'checkbox' : 'radio'}
                  aria-checked={on}
                  onClick={() => toggle(q, opt.label)}
                  title={opt.description || undefined}
                  className={cn(
                    BTN,
                    'flex max-w-full flex-col items-start text-left',
                    on ? 'border-accent bg-accent/15 text-text' : 'border-border text-text hover:bg-bg-tertiary',
                  )}
                >
                  <span>{opt.label}</span>
                  {opt.description ? <span className="text-[10.5px] font-normal text-text-muted">{opt.description}</span> : null}
                </button>
              )
            })}
          </div>
          <input
            type="text"
            placeholder="Other…"
            aria-label={`Other answer to: ${q.question}`}
            value={other[q.question] ?? ''}
            onChange={(e) => setOther((was) => ({ ...was, [q.question]: e.target.value }))}
            className="w-full max-w-sm rounded-md border border-border bg-bg px-2! py-1! text-[12px] text-text placeholder:text-text-muted focus:border-accent focus:outline-none"
          />
        </fieldset>
      ))}
      {enabled ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!complete}
            onClick={() => onSubmit(Object.fromEntries(questions.map((q) => [q.question, answerOf(q)])))}
            className={cn(BTN, 'border-warning/70 bg-warning/15 text-text hover:bg-warning/25')}
          >
            Send answers
          </button>
          <button type="button" onClick={onDeny} className={cn(BTN, 'border-danger/50 text-danger hover:bg-danger/10')}>
            Decline
          </button>
        </div>
      ) : null}
    </div>
  )
}
