// A tool call and its result, as one card — plus the folded group a run of
// consecutive calls collapses into. Edit/MultiEdit/Write draw a diff, Bash
// draws a terminal, TodoWrite draws a checklist; everything else shows the
// input JSON and the output.

import React, { useState } from 'react'
import { cn } from '../../lib/cn'
import { ChevronRight, Spinner, Wrench } from './icons'
import { oneLine, pretty, toolDigest, type Row, type ToolEvent, type ToolResultEvent } from './transcript'

/* --- line diff ------------------------------------------------------------ */

export interface DiffLine {
  type: 'add' | 'del' | 'ctx'
  text: string
}

const MAX_LCS = 400

/** Line-level diff of two strings (LCS; falls back to all-removed/all-added when large). */
export const lineDiff = (before: string, after: string): DiffLine[] => {
  const a = before === '' ? [] : before.split('\n')
  const b = after === '' ? [] : after.split('\n')
  if (a.length > MAX_LCS || b.length > MAX_LCS) {
    return [...a.map((text) => ({ type: 'del' as const, text })), ...b.map((text) => ({ type: 'add' as const, text }))]
  }
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'ctx', text: a[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: 'del', text: a[i++] })
    } else {
      out.push({ type: 'add', text: b[j++] })
    }
  }
  while (i < n) out.push({ type: 'del', text: a[i++] })
  while (j < m) out.push({ type: 'add', text: b[j++] })
  return out
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '')
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

/** The diff a file-editing tool call describes, or null for any other tool. */
export const diffOf = (call: ToolEvent): DiffLine[] | null => {
  const input = record(call.input)
  if (call.name === 'Edit') return lineDiff(str(input.old_string), str(input.new_string))
  if (call.name === 'MultiEdit' && Array.isArray(input.edits)) {
    return input.edits.flatMap((edit, index) => {
      const held = record(edit)
      const lines = lineDiff(str(held.old_string), str(held.new_string))
      return index > 0 ? [{ type: 'ctx' as const, text: '⋯' }, ...lines] : lines
    })
  }
  if (call.name === 'Write') return lineDiff('', str(input.content))
  return null
}

function DiffView({ lines, open }: { lines: DiffLine[]; open: boolean }) {
  const adds = lines.filter((l) => l.type === 'add').length
  const dels = lines.filter((l) => l.type === 'del').length
  return (
    <div className="border-t border-border">
      <div
        className={cn(
          'overflow-auto bg-bg font-mono text-[11px] leading-[1.55]',
          open ? 'max-h-[28rem]' : 'max-h-40 overflow-hidden',
        )}
      >
        {lines.map((line, i) => (
          <div
            key={i}
            className={cn(
              'flex whitespace-pre-wrap break-all',
              line.type === 'add' && 'bg-success/12 text-text',
              line.type === 'del' && 'bg-danger/12 text-text',
              line.type === 'ctx' && 'text-text-muted',
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'w-5 shrink-0 select-none text-center',
                line.type === 'add' && 'text-success',
                line.type === 'del' && 'text-danger',
              )}
            >
              {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}
            </span>
            <span className="min-w-0 flex-1 pr-2!">{line.text || ' '}</span>
          </div>
        ))}
      </div>
      <p className="flex gap-2 border-t border-border bg-bg-secondary px-2.5! py-1! font-mono text-[10px]">
        <span className="text-success">+{adds}</span>
        <span className="text-danger">-{dels}</span>
      </p>
    </div>
  )
}

function BashView({ command, result, open }: { command: string; result: ToolResultEvent | null; open: boolean }) {
  return (
    <div
      className={cn(
        'overflow-auto border-t border-border bg-bg font-mono text-[11px] leading-relaxed',
        open ? 'max-h-[28rem]' : 'max-h-36 overflow-hidden',
      )}
    >
      <pre className="whitespace-pre-wrap break-words px-2.5! pt-2! text-text">
        <span className="select-none text-success">$ </span>
        {command}
      </pre>
      {result ? (
        <pre
          className={cn(
            'whitespace-pre-wrap break-words px-2.5! pb-2! pt-1!',
            result.ok ? 'text-text-muted' : 'text-danger',
          )}
        >
          {result.text || '(no output)'}
        </pre>
      ) : (
        <p className="flex items-center gap-2 px-2.5! pb-2! pt-1! text-text-muted">
          <Spinner /> running…
        </p>
      )}
    </div>
  )
}

interface Todo {
  content: string
  status: string
  activeForm?: string
}

export const todosOf = (input: unknown): Todo[] | null => {
  const todos = record(input).todos
  if (!Array.isArray(todos)) return null
  return todos.map((t) => {
    const held = record(t)
    return { content: str(held.content), status: str(held.status) || 'pending', activeForm: str(held.activeForm) }
  })
}

function TodoView({ todos }: { todos: Todo[] }) {
  return (
    <ul className="flex flex-col gap-1 border-t border-border px-3! py-2! text-[12px]" aria-label="Todo list">
      {todos.map((todo, i) => (
        <li key={i} className="flex items-start gap-2">
          <span
            aria-hidden="true"
            className={cn(
              'mt-[3px]! grid size-3 shrink-0 place-items-center rounded-[3px] border text-[9px] leading-none',
              todo.status === 'completed' && 'border-success bg-success text-bg',
              todo.status === 'in_progress' && 'border-accent',
              todo.status === 'pending' && 'border-border',
            )}
          >
            {todo.status === 'completed' ? '✓' : todo.status === 'in_progress' ? <span className="size-1.5 rounded-full bg-accent" /> : null}
          </span>
          <span
            className={cn(
              'min-w-0',
              todo.status === 'completed' && 'text-text-muted line-through',
              todo.status === 'in_progress' && 'font-medium text-text',
            )}
          >
            {todo.status === 'in_progress' && todo.activeForm ? todo.activeForm : todo.content}
            <span className="sr-only"> ({todo.status.replace('_', ' ')})</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

/* --- the card -------------------------------------------------------------- */

export function ToolStatus({ result }: { result: ToolResultEvent | null }) {
  if (!result) return <Spinner className="text-accent" />
  return result.ok ? (
    <span className="shrink-0 text-[10.5px] font-semibold text-success">passed</span>
  ) : (
    <span className="shrink-0 text-[10.5px] font-semibold text-danger">failed</span>
  )
}

const LABEL = 'shrink-0 text-[10px] font-semibold uppercase tracking-[0.06em] text-text-muted'

export function ToolCard({ call, result }: { call: ToolEvent; result: ToolResultEvent | null }) {
  const [open, setOpen] = useState(false)
  const digest = oneLine(toolDigest(call.input))
  const failed = result !== null && !result.ok
  const diff = diffOf(call)
  const todos = call.name === 'TodoWrite' ? todosOf(call.input) : null
  const isBash = call.name === 'Bash'
  const command = str(record(call.input).command)

  return (
    <div
      className={cn(
        'w-full overflow-hidden rounded-md border bg-bg-secondary transition-colors',
        failed ? 'border-danger/50' : 'border-border',
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className="flex w-full items-center gap-2.5 px-2.5! py-1.5! text-left hover:bg-bg-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
      >
        <span className={LABEL}>{call.name}</span>
        {digest ? (
          <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-text">{digest}</code>
        ) : (
          <span className="flex-1" />
        )}
        <ToolStatus result={result} />
        <ChevronRight size={12} className={cn('shrink-0 text-text-muted transition-transform', open && 'rotate-90')} />
      </button>

      {diff ? <DiffView lines={diff} open={open} /> : null}
      {isBash && command ? <BashView command={command} result={result} open={open} /> : null}
      {todos ? <TodoView todos={todos} /> : null}

      {open ? (
        <div className="border-t border-border">
          <p className={cn(LABEL, 'bg-bg-tertiary px-2.5! py-1!')}>input</p>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words bg-bg px-2.5! py-2! font-mono text-[11px] leading-relaxed text-text-muted">
            {pretty(call.input)}
          </pre>
        </div>
      ) : null}

      {/* Bash already shows its own output; the others show it here. Diffs and todos only once opened. */}
      {!isBash && (open || (!diff && !todos)) ? (
        result ? (
          <div className="border-t border-border">
            {open ? <p className={cn(LABEL, 'bg-bg-tertiary px-2.5! py-1!')}>{result.ok ? 'output' : 'error'}</p> : null}
            <pre
              className={cn(
                'whitespace-pre-wrap break-words bg-bg px-2.5! py-2! font-mono text-[11px] leading-relaxed',
                open ? 'max-h-[24rem] overflow-auto' : 'max-h-24 overflow-hidden',
                result.ok ? 'text-text-muted' : 'bg-danger/8 text-danger',
              )}
            >
              {result.text || '(nothing)'}
            </pre>
          </div>
        ) : (
          <p className="flex items-center gap-2 border-t border-border px-2.5! py-1.5! text-[11px] text-text-muted">
            <Spinner /> waiting for a result…
          </p>
        )
      ) : null}
    </div>
  )
}

/* --- the folded group ----------------------------------------------------- */

export function ToolGroup({ rows }: { rows: Row[] }) {
  const [open, setOpen] = useState(false)
  const failed = rows.filter((row) => row.result && !row.result.ok).length
  const pending = rows.some((row) => !row.result)
  const names = [...new Set(rows.map((row) => (row.event as ToolEvent).name))].join(', ')
  const dot = failed ? 'bg-danger' : pending ? 'bg-accent animate-pulse motion-reduce:animate-none' : 'bg-success'

  return (
    <div className="rounded-md bg-bg-secondary/70 text-[12px] text-text-muted">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className="flex w-full min-w-0 items-center gap-2 rounded-md px-2.5! py-1.5! text-left hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Wrench size={12} className="shrink-0" />
        <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', dot)} />
        <span className="shrink-0">
          {rows.length} {rows.length === 1 ? 'tool' : 'tools'}
        </span>
        {names ? <span className="min-w-0 truncate font-mono text-[11px]">· {names}</span> : null}
        {failed ? (
          <span className="shrink-0 rounded border border-danger/40 bg-danger/10 px-1.5! text-[10px] font-medium text-danger">
            {failed} failed
          </span>
        ) : null}
        <ChevronRight size={12} className={cn('ml-auto! shrink-0 transition-transform', open && 'rotate-90')} />
      </button>
      {open ? (
        <div className="flex flex-col gap-1.5 px-1.5! pb-1.5!">
          {rows.map((row) => (
            <ToolCard key={row.key} call={row.event as ToolEvent} result={row.result} />
          ))}
        </div>
      ) : null}
    </div>
  )
}
