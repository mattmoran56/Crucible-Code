// The model pill under the composer. Opens upward; disabled (with a reason)
// while a turn is running, since the CLI applies a model change between turns.

import React, { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from 'react'
import { VISUAL_AGENT_MODELS, type VisualAgentModel } from '../../../shared/visual-agent'
import { cn } from '../../lib/cn'
import { Check, ChevronUp } from './icons'

export const modelLabel = (id: string, models: readonly VisualAgentModel[] = VISUAL_AGENT_MODELS): string =>
  models.find((m) => m.id === id)?.label ?? id.replace(/^claude-/, '')

export interface ModelPickerHandle {
  open: () => void
}

export const ModelPicker = forwardRef<
  ModelPickerHandle,
  {
    model: string
    onChange: (model: string) => void
    disabled?: boolean
    disabledReason?: string
    models?: readonly VisualAgentModel[]
  }
>(function ModelPicker({ model, onChange, disabled = false, disabledReason, models = VISUAL_AGENT_MODELS }, ref) {
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState(0)
  const button = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const listId = useId()

  const show = (): void => {
    if (disabled) return
    setAt(Math.max(0, models.findIndex((m) => m.id === model)))
    setOpen(true)
  }
  useImperativeHandle(ref, () => ({ open: show }))

  useEffect(() => {
    if (open) list.current?.focus()
  }, [open])

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  const pick = (id: string): void => {
    setOpen(false)
    button.current?.focus()
    if (id !== model) onChange(id)
  }

  return (
    <div className="relative">
      <button
        ref={button}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-disabled={disabled || undefined}
        title={disabled ? (disabledReason ?? 'Unavailable') : 'Choose the model'}
        onClick={() => (open ? setOpen(false) : show())}
        className={cn(
          'inline-flex items-center gap-1 rounded-full border border-border px-2! py-[2px]! text-[11px] transition-colors',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          disabled ? 'cursor-not-allowed text-text-muted opacity-60' : 'text-text-muted hover:border-accent/50 hover:text-text',
        )}
      >
        <span className="font-medium">{modelLabel(model, models)}</span>
        <ChevronUp size={10} />
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-30" aria-hidden="true" onMouseDown={() => setOpen(false)} />
          <ul
            ref={list}
            id={listId}
            role="listbox"
            tabIndex={-1}
            aria-label="Model"
            aria-activedescendant={`${listId}-${at}`}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault()
                const step = e.key === 'ArrowDown' ? 1 : -1
                setAt((held) => (held + step + models.length) % models.length)
              } else if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                const held = models[at]
                if (held) pick(held.id)
              } else if (e.key === 'Escape' || e.key === 'Tab') {
                e.preventDefault()
                e.stopPropagation()
                setOpen(false)
                button.current?.focus()
              }
            }}
            className="absolute bottom-[calc(100%+6px)] left-0 z-40 w-64 overflow-hidden rounded-lg border border-border bg-bg-secondary py-1! shadow-2xl outline-none animate-[va-rise_150ms_ease-out] motion-reduce:animate-none"
          >
            {models.map((m, index) => (
              <li
                key={m.id}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={m.id === model}
                onMouseMove={() => setAt(index)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(m.id)
                }}
                className={cn('flex cursor-pointer items-start gap-2 px-3! py-1.5!', index === at && 'bg-accent/15')}
              >
                <span className="mt-[2px]! w-3 shrink-0 text-accent">{m.id === model ? <Check size={11} /> : null}</span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-[12px] font-medium text-text">{m.label}</span>
                  <span className="text-[10.5px] text-text-muted">{m.hint}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  )
})
