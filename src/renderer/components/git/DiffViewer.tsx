import React, { useState, useCallback, useRef, useMemo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useGitStore, WORKING_CHANGES_HASH } from '../../stores/gitStore'
import { ToggleGroup } from '../ui/ToggleGroup'
import { useDiffHighlighting, type TokenMap } from '../../hooks/useDiffHighlighting'
import type { ThemedToken } from 'shiki'
import type { PRComment, PRReviewThread } from '../../../shared/types'
import { ImageDiffViewer, isImageFile } from './ImageDiffViewer'
import { DiffErrorBoundary } from '../ui/DiffErrorBoundary'
import { InlineThread, OrphanComment } from '../pullrequests/InlineThread'
import { useExpandableBlob } from './useExpandableBlob'

// --- Patch parsing ---

export interface ExpanderMeta {
  prevOldEnd: number
  prevNewEnd: number
  nextOldStart: number | null
  nextNewStart: number | null
  /** True if this expander is positioned after the last hunk (file may extend further). */
  isTail?: boolean
}

export interface DiffLine {
  type: 'header' | 'context' | 'add' | 'delete' | 'hunk' | 'expander'
  content: string
  oldLine?: number
  newLine?: number
  /** Sequential id of the hunk this line belongs to (hunk row included). */
  hunkId?: number
  /** Set on `expander` rows. */
  expander?: ExpanderMeta
}

export function parsePatch(patch: string): DiffLine[] {
  const sourceLines = patch.split('\n')
  const result: DiffLine[] = []

  let oldLine = 0
  let newLine = 0
  let inDiff = false
  let hunkId = -1

  // Track the running end-of-hunk so we can synthesise expanders.
  let lastOldEnd = 0
  let lastNewEnd = 0
  let lastHadHunk = false

  for (const line of sourceLines) {
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
      const oldStart = match ? parseInt(match[1], 10) : 0
      const oldCount = match ? parseInt(match[2] ?? '1', 10) : 0
      const newStart = match ? parseInt(match[3], 10) : 0
      const newCount = match ? parseInt(match[4] ?? '1', 10) : 0

      // Emit an expander between the previous hunk (or file top) and this hunk.
      const prevOldEnd = lastHadHunk ? lastOldEnd : 0
      const prevNewEnd = lastHadHunk ? lastNewEnd : 0
      const gap = newStart - 1 - prevNewEnd
      if (gap > 0) {
        result.push({
          type: 'expander',
          content: '',
          expander: {
            prevOldEnd,
            prevNewEnd,
            nextOldStart: oldStart,
            nextNewStart: newStart,
          },
        })
      }

      hunkId += 1
      inDiff = true
      oldLine = oldStart
      newLine = newStart
      lastOldEnd = oldStart + Math.max(oldCount, 1) - 1
      lastNewEnd = newStart + Math.max(newCount, 1) - 1
      lastHadHunk = true

      result.push({ type: 'hunk', content: line, hunkId })
    } else if (!inDiff) {
      result.push({ type: 'header', content: line })
    } else if (line.startsWith('+')) {
      result.push({ type: 'add', content: line.slice(1), newLine: newLine++, hunkId })
    } else if (line.startsWith('-')) {
      result.push({ type: 'delete', content: line.slice(1), oldLine: oldLine++, hunkId })
    } else {
      result.push({
        type: 'context',
        content: line.startsWith(' ') ? line.slice(1) : line,
        oldLine: oldLine++,
        newLine: newLine++,
        hunkId,
      })
    }
  }

  // Tail expander after the last hunk so users can extend down into the file.
  if (lastHadHunk) {
    result.push({
      type: 'expander',
      content: '',
      expander: {
        prevOldEnd: lastOldEnd,
        prevNewEnd: lastNewEnd,
        nextOldStart: null,
        nextNewStart: null,
        isTail: true,
      },
    })
  }

  return result
}

// --- Split diff conversion ---

interface SplitRow {
  left: DiffLine | null
  right: DiffLine | null
}

function toSplitRows(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (line.type === 'header' || line.type === 'hunk' || line.type === 'expander') {
      rows.push({ left: line, right: line })
      i++
    } else if (line.type === 'context') {
      rows.push({ left: line, right: line })
      i++
    } else if (line.type === 'delete') {
      const deletes: DiffLine[] = []
      while (i < lines.length && lines[i].type === 'delete') {
        deletes.push(lines[i])
        i++
      }
      const adds: DiffLine[] = []
      while (i < lines.length && lines[i].type === 'add') {
        adds.push(lines[i])
        i++
      }
      const maxLen = Math.max(deletes.length, adds.length)
      for (let j = 0; j < maxLen; j++) {
        rows.push({
          left: j < deletes.length ? deletes[j] : null,
          right: j < adds.length ? adds[j] : null,
        })
      }
    } else if (line.type === 'add') {
      rows.push({ left: null, right: line })
      i++
    } else {
      i++
    }
  }

  return rows
}

// --- Display lines: splice in expanded context, drop collapsed hunks ---

export interface DisplayOptions {
  expandedNewLines: Set<number> | undefined
  blobLines: string[] | null
  collapsedHunks: Set<number>
}

export function buildDisplayLines(parsed: DiffLine[], opts: DisplayOptions): DiffLine[] {
  const out: DiffLine[] = []
  const { expandedNewLines, blobLines, collapsedHunks } = opts

  for (const line of parsed) {
    if (line.type === 'expander' && line.expander) {
      const { prevOldEnd, prevNewEnd, nextNewStart, isTail } = line.expander
      const upperBound = isTail
        ? blobLines?.length ?? prevNewEnd
        : (nextNewStart ?? prevNewEnd + 1) - 1

      if (upperBound <= prevNewEnd) {
        // Nothing to expand — shouldn't happen but bail out safely.
        out.push(line)
        continue
      }

      let cursor = prevNewEnd + 1
      const isExpanded = (n: number) => expandedNewLines?.has(n)
      while (cursor <= upperBound) {
        if (isExpanded(cursor) && blobLines && cursor - 1 < blobLines.length) {
          const newLine = cursor
          const oldLine = prevOldEnd + (cursor - prevNewEnd)
          out.push({
            type: 'context',
            content: blobLines[newLine - 1] ?? '',
            oldLine,
            newLine,
          })
          cursor++
        } else {
          // Find run of unexpanded lines
          let runEnd = cursor
          while (runEnd <= upperBound && !isExpanded(runEnd)) runEnd++
          out.push({
            type: 'expander',
            content: '',
            expander: {
              prevOldEnd: prevOldEnd + (cursor - prevNewEnd - 1),
              prevNewEnd: cursor - 1,
              nextOldStart: isTail ? null : line.expander.nextOldStart,
              nextNewStart: isTail ? null : runEnd, // first not-yet-expanded boundary
              isTail,
            },
          })
          cursor = runEnd
        }
      }
      continue
    }

    if (line.hunkId != null && line.type !== 'hunk' && collapsedHunks.has(line.hunkId)) {
      continue
    }
    out.push(line)
  }

  return out
}

// --- Styles ---
//
// GitHub-inspired diff layout. Each line is composed of three visual zones:
//   1. Gutter (line-number columns + add-comment "+") — slightly more
//      saturated than the body so it reads as a sidebar.
//   2. Indicator (the +/- column) — strongest tint so the eye can scan it.
//   3. Body (the code) — softest tint, just enough to mark the row.
// Context rows are completely untinted to keep the eye on the actual change.

const ROW_BODY: Record<string, string> = {
  header: 'bg-bg-tertiary text-text-muted',
  hunk: 'bg-accent/8 text-accent',
  context: '',
  add: 'bg-success/8',
  delete: 'bg-danger/8',
  expander: 'bg-bg-tertiary',
}

const ROW_GUTTER: Record<string, string> = {
  add: 'bg-success/15 text-success/70',
  delete: 'bg-danger/15 text-danger/70',
  context: 'text-text-muted/60',
  hunk: 'bg-accent/15 text-accent',
  header: 'text-text-muted/60',
  expander: '',
}

const ROW_INDICATOR: Record<string, string> = {
  add: 'bg-success/20 text-success',
  delete: 'bg-danger/20 text-danger',
  context: '',
  hunk: '',
  header: '',
  expander: '',
}

const INDICATOR_GLYPH: Record<string, string> = {
  add: '+',
  delete: '−',
}

// --- Highlighted code rendering ---

function HighlightedCode({ tokens, fallback }: { tokens?: ThemedToken[]; fallback: string }) {
  if (!tokens || tokens.length === 0) return <>{fallback}</>
  return (
    <>
      {tokens.map((token, i) => (
        <span key={i} style={{ color: token.color }}>
          {token.content}
        </span>
      ))}
    </>
  )
}

type DiffMode = 'unified' | 'split'

// --- Comment range tracking ---

interface CommentRange {
  startLine: number
  endLine: number
  side: 'LEFT' | 'RIGHT'
}

function useLineDrag(onAddComment?: (startLine: number, endLine: number, side: 'LEFT' | 'RIGHT', body: string) => void) {
  const [dragRange, setDragRange] = useState<{ start: number; end: number; side: 'LEFT' | 'RIGHT' } | null>(null)
  const [commentRange, setCommentRange] = useState<CommentRange | null>(null)
  const isDragging = useRef(false)

  const startDrag = useCallback((lineNum: number, side: 'LEFT' | 'RIGHT') => {
    if (!onAddComment) return
    isDragging.current = true
    setDragRange({ start: lineNum, end: lineNum, side })
    setCommentRange(null)

    const handleMouseUp = () => {
      isDragging.current = false
      setDragRange((prev) => {
        if (prev) {
          const startLine = Math.min(prev.start, prev.end)
          const endLine = Math.max(prev.start, prev.end)
          setCommentRange({ startLine, endLine, side: prev.side })
        }
        return null
      })
      document.removeEventListener('mouseup', handleMouseUp)
    }
    document.addEventListener('mouseup', handleMouseUp)
  }, [onAddComment])

  const extendDrag = useCallback((lineNum: number, side: 'LEFT' | 'RIGHT') => {
    if (!isDragging.current) return
    setDragRange((prev) => {
      if (!prev || prev.side !== side) return prev
      return { ...prev, end: lineNum }
    })
  }, [])

  const rangePosition = useCallback((lineNum: number, side: 'LEFT' | 'RIGHT'): 'none' | 'first' | 'middle' | 'last' | 'only' => {
    let lo: number, hi: number, rangeSide: 'LEFT' | 'RIGHT'
    if (dragRange) {
      lo = Math.min(dragRange.start, dragRange.end)
      hi = Math.max(dragRange.start, dragRange.end)
      rangeSide = dragRange.side
    } else if (commentRange) {
      lo = commentRange.startLine
      hi = commentRange.endLine
      rangeSide = commentRange.side
    } else {
      return 'none'
    }
    if (rangeSide !== side) return 'none'
    if (lineNum < lo || lineNum > hi) return 'none'
    if (lo === hi) return 'only'
    if (lineNum === lo) return 'first'
    if (lineNum === hi) return 'last'
    return 'middle'
  }, [dragRange, commentRange])

  const cancelComment = useCallback(() => {
    setCommentRange(null)
  }, [])

  const submitComment = useCallback((body: string) => {
    if (!commentRange || !onAddComment) return
    onAddComment(commentRange.startLine, commentRange.endLine, commentRange.side, body)
    setCommentRange(null)
  }, [commentRange, onAddComment])

  return { dragRange, commentRange, startDrag, extendDrag, rangePosition, cancelComment, submitComment }
}

// --- Plus button gutter ---

function GutterButton({
  lineNum,
  side,
  rangePos,
  onMouseDown,
  onMouseEnter,
}: {
  lineNum: number
  side: 'LEFT' | 'RIGHT'
  rangePos: 'none' | 'first' | 'middle' | 'last' | 'only'
  onMouseDown: (lineNum: number, side: 'LEFT' | 'RIGHT') => void
  onMouseEnter: (lineNum: number, side: 'LEFT' | 'RIGHT') => void
}) {
  const inRange = rangePos !== 'none'
  return (
    <span
      className={`w-5 shrink-0 flex items-center justify-center cursor-pointer select-none relative ${
        inRange ? 'text-accent' : 'opacity-0 group-hover:opacity-100 text-accent'
      }`}
      style={{ fontSize: '14px', fontWeight: 700 }}
      onMouseDown={(e) => {
        e.preventDefault()
        onMouseDown(lineNum, side)
      }}
      onMouseEnter={() => onMouseEnter(lineNum, side)}
      title="Add comment (drag to select range)"
    >
      {(rangePos === 'first' || rangePos === 'middle' || rangePos === 'last') && (
        <span
          className="absolute left-[9px] bg-accent"
          style={{
            width: '2px',
            top: rangePos === 'first' ? '50%' : '0',
            bottom: rangePos === 'last' ? '50%' : '0',
          }}
        />
      )}
      {inRange ? (
        <span className="relative z-10 w-2.5 h-2.5 rounded-full bg-accent" />
      ) : (
        '+'
      )}
    </span>
  )
}

// --- Comment form inline ---

function InlineCommentForm({
  startLine,
  endLine,
  onSubmit,
  onCancel,
}: {
  startLine: number
  endLine: number
  onSubmit: (body: string) => void
  onCancel: () => void
}) {
  const [text, setText] = useState('')
  const rangeLabel = startLine === endLine ? `Line ${startLine}` : `Lines ${startLine}–${endLine}`

  return (
    <div className="flex flex-col gap-1.5 px-2 py-2 bg-bg-secondary border-y border-border">
      <span className="text-[10px] text-text-muted">{rangeLabel}</span>
      <div className="flex gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a comment..."
          className="flex-1 bg-bg text-text text-xs font-mono border border-border rounded resize-none focus:outline-none focus:border-accent"
          style={{ padding: '8px 10px' }}
          rows={2}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              if (text.trim()) onSubmit(text.trim())
            }
            if (e.key === 'Escape') onCancel()
          }}
        />
        <div className="flex flex-col gap-1.5">
          <button
            className="bg-accent text-white text-xs rounded hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            style={{ padding: '4px 10px' }}
            onClick={() => {
              if (text.trim()) onSubmit(text.trim())
            }}
          >
            Comment
          </button>
          <button
            className="text-text-muted text-xs rounded hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            style={{ padding: '4px 10px' }}
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// --- Expander row ---

interface ExpanderRowProps {
  meta: ExpanderMeta
  onExpand: (direction: 'up' | 'down' | 'all', meta: ExpanderMeta) => void
  enabled: boolean
}

function ExpanderRow({ meta, onExpand, enabled }: ExpanderRowProps) {
  const hasUpper = meta.nextNewStart != null && !meta.isTail
  const lo = meta.prevNewEnd + 1
  const hi = hasUpper ? meta.nextNewStart! - 1 : Infinity
  const gap = Number.isFinite(hi) ? Math.max(0, hi - lo + 1) : null
  const label = gap != null
    ? `Show ${gap} unchanged ${gap === 1 ? 'line' : 'lines'}`
    : 'Show more lines below'

  // The whole row is one big clickable surface — the default action is
  // "expand all" for an in-between gap (no use leaving lines hidden once
  // the user has asked for them) or "expand 20 down" for a tail expander
  // (no upper bound to expand to). The discrete arrow buttons inside the
  // row stop propagation so they can override that default.
  const defaultDirection: 'up' | 'down' | 'all' = hasUpper ? 'all' : 'down'

  const arrowBtn =
    'relative z-10 flex items-center justify-center text-text-muted hover:text-accent hover:bg-accent/10 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent'

  const handleRowKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!enabled) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onExpand(defaultDirection, meta)
    }
  }

  return (
    <div
      role="button"
      tabIndex={enabled ? 0 : -1}
      aria-label={label}
      className={`group flex items-stretch leading-5 bg-accent/5 border-y border-border text-[10px] text-text-muted select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${
        enabled ? 'cursor-pointer hover:bg-accent/10 hover:text-accent' : 'cursor-not-allowed'
      }`}
      style={{ minHeight: 24 }}
      title={enabled ? label : 'Loading file content needed to expand context…'}
      data-expander-row="true"
      onClick={() => enabled && onExpand(defaultDirection, meta)}
      onKeyDown={handleRowKey}
    >
      <div className="flex items-stretch w-[80px] shrink-0 border-r border-border/40 bg-accent/10">
        {hasUpper && (
          <button
            type="button"
            className={`${arrowBtn} flex-1`}
            disabled={!enabled}
            onClick={(e) => {
              e.stopPropagation()
              onExpand('up', meta)
            }}
            aria-label="Expand 20 lines up"
            title="Expand 20 lines up"
            data-expand-direction="up"
          >
            ↑20
          </button>
        )}
        <button
          type="button"
          className={`${arrowBtn} flex-1`}
          disabled={!enabled}
          onClick={(e) => {
            e.stopPropagation()
            onExpand('down', meta)
          }}
          aria-label="Expand 20 lines down"
          title="Expand 20 lines down"
          data-expand-direction="down"
        >
          ↓20
        </button>
        {hasUpper && (
          <button
            type="button"
            className={`${arrowBtn} flex-1`}
            disabled={!enabled}
            onClick={(e) => {
              e.stopPropagation()
              onExpand('all', meta)
            }}
            aria-label="Expand all unchanged lines"
            title="Expand all unchanged lines"
            data-expand-direction="all"
          >
            ⇕
          </button>
        )}
      </div>
      <span className="flex-1 flex items-center px-3 truncate">{label}</span>
    </div>
  )
}

// --- Comment / thread lookup ---

interface ThreadLookup {
  threadByLine: Map<string, PRReviewThread>
  /** Comments not associated with a thread (e.g. older REST comments before threads loaded). */
  orphansByLine: Map<string, PRComment[]>
}

function useThreadLookup(
  comments: PRComment[],
  threads: PRReviewThread[],
  filePath: string | null,
): ThreadLookup {
  return useMemo(() => {
    const threadByLine = new Map<string, PRReviewThread>()
    const orphansByLine = new Map<string, PRComment[]>()
    const claimedIds = new Set<number>()

    if (!filePath) return { threadByLine, orphansByLine }

    for (const t of threads) {
      if (t.path !== filePath || t.line == null) continue
      const side = t.side ?? 'RIGHT'
      threadByLine.set(`${t.line}:${side}`, t)
      for (const c of t.comments) claimedIds.add(c.id)
    }

    for (const c of comments) {
      if (c.path !== filePath || c.line == null) continue
      if (claimedIds.has(c.id)) continue
      const key = `${c.line}:${c.side || 'RIGHT'}`
      const arr = orphansByLine.get(key)
      if (arr) arr.push(c)
      else orphansByLine.set(key, [c])
    }

    return { threadByLine, orphansByLine }
  }, [comments, threads, filePath])
}

// --- Unified diff view ---

interface ViewProps {
  lines: DiffLine[]
  comments: PRComment[]
  threads: PRReviewThread[]
  filePath: string | null
  tokenMap: TokenMap | null
  onAddComment?: (startLine: number, endLine: number, side: 'LEFT' | 'RIGHT', body: string) => void
  onExpand?: (direction: 'up' | 'down' | 'all', meta: ExpanderMeta) => void
  expandEnabled?: boolean
  collapsedHunks: Set<number>
  onToggleHunk: (id: number) => void
  onReplyThread?: (rootCommentId: number, body: string) => void | Promise<void>
  onResolveThread?: (threadId: string) => void | Promise<void>
  onUnresolveThread?: (threadId: string) => void | Promise<void>
  onApplySuggestion?: (startLine: number, endLine: number, newText: string, author: string) => void | Promise<void>
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
}

function UnifiedView({
  lines, comments, threads, filePath, tokenMap, onAddComment,
  onExpand, expandEnabled,
  collapsedHunks, onToggleHunk,
  onReplyThread, onResolveThread, onUnresolveThread, onApplySuggestion,
  scrollContainerRef,
}: ViewProps) {
  const { commentRange, startDrag, extendDrag, rangePosition, cancelComment, submitComment } = useLineDrag(onAddComment)
  const { threadByLine, orphansByLine } = useThreadLookup(comments, threads, filePath)

  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 20,
    overscan: 20,
    measureElement: (el) => el.getBoundingClientRect().height,
  })

  return (
    <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
      {virtualizer.getVirtualItems().map((virtualRow) => {
        const i = virtualRow.index
        const line = lines[i]

        if (line.type === 'expander' && line.expander) {
          return (
            <div
              key={i}
              ref={virtualizer.measureElement}
              data-index={i}
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${virtualRow.start}px)` }}
            >
              <ExpanderRow meta={line.expander} onExpand={onExpand ?? (() => {})} enabled={!!onExpand && !!expandEnabled} />
            </div>
          )
        }

        const isHunkRow = line.type === 'hunk'
        const lineNum = line.newLine ?? line.oldLine
        const canComment = onAddComment && lineNum != null && (line.type === 'add' || line.type === 'delete' || line.type === 'context')
        const side: 'LEFT' | 'RIGHT' = line.type === 'delete' ? 'LEFT' : 'RIGHT'
        const rangePos = lineNum != null ? rangePosition(lineNum, side) : 'none' as const
        const highlighted = rangePos !== 'none'
        const lineKey = lineNum != null ? `${lineNum}:${side}` : ''
        const thread = lineKey ? threadByLine.get(lineKey) : undefined
        const orphans = lineKey ? orphansByLine.get(lineKey) ?? [] : []
        const showForm = commentRange && lineNum === commentRange.endLine && commentRange.side === side
        const isCollapsed = isHunkRow && line.hunkId != null && collapsedHunks.has(line.hunkId)

        const bodyTint = ROW_BODY[line.type] ?? ''
        const gutterTint = ROW_GUTTER[line.type] ?? ''
        const indicatorTint = ROW_INDICATOR[line.type] ?? ''

        return (
          <div
            key={i}
            ref={virtualizer.measureElement}
            data-index={i}
            data-line-type={line.type}
            data-old-line={line.oldLine ?? undefined}
            data-new-line={line.newLine ?? undefined}
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${virtualRow.start}px)` }}
          >
            <div
              className={`group flex leading-5 ${highlighted ? 'bg-accent/15' : ''} ${isHunkRow ? 'cursor-pointer hover:bg-accent/15' : ''}`}
              onMouseEnter={() => lineNum != null && extendDrag(lineNum, side)}
              onClick={isHunkRow && line.hunkId != null ? () => onToggleHunk(line.hunkId!) : undefined}
              title={isHunkRow ? (isCollapsed ? 'Expand hunk' : 'Collapse hunk') : undefined}
            >
              <span className={`flex shrink-0 ${gutterTint}`}>
                {isHunkRow ? (
                  <span className="w-5 text-center select-none">
                    {isCollapsed ? '▸' : '▾'}
                  </span>
                ) : canComment ? (
                  <GutterButton lineNum={lineNum!} side={side} rangePos={rangePos} onMouseDown={startDrag} onMouseEnter={extendDrag} />
                ) : (
                  <span className="w-5" />
                )}
                <span className="w-10 text-right select-none pr-2 tabular-nums">
                  {line.oldLine ?? ''}
                </span>
                <span className="w-10 text-right select-none pr-2 tabular-nums border-r border-border/40">
                  {line.newLine ?? ''}
                </span>
              </span>
              <span className={`w-5 text-center select-none shrink-0 ${indicatorTint}`}>
                {INDICATOR_GLYPH[line.type] || ''}
              </span>
              <pre className={`flex-1 whitespace-pre-wrap break-all pl-2 pr-2 ${bodyTint}`}>
                <HighlightedCode tokens={tokenMap?.get(i)} fallback={line.content} />
              </pre>
            </div>
            {thread && (
              <InlineThread
                thread={thread}
                onReply={onReplyThread}
                onResolve={onResolveThread}
                onUnresolve={onUnresolveThread}
                onApplySuggestion={onApplySuggestion}
              />
            )}
            {orphans.map((c) => (
              <OrphanComment key={c.id} comment={c} />
            ))}
            {showForm && (
              <InlineCommentForm
                startLine={commentRange.startLine}
                endLine={commentRange.endLine}
                onSubmit={submitComment}
                onCancel={cancelComment}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

// --- Split diff view ---

function SplitView({
  lines, comments, threads, filePath, tokenMap, onAddComment,
  onExpand, expandEnabled,
  collapsedHunks, onToggleHunk,
  onReplyThread, onResolveThread, onUnresolveThread, onApplySuggestion,
  scrollContainerRef,
}: ViewProps) {
  const rows = useMemo(() => toSplitRows(lines), [lines])
  const { commentRange, startDrag, extendDrag, rangePosition, cancelComment, submitComment } = useLineDrag(onAddComment)
  const { threadByLine, orphansByLine } = useThreadLookup(comments, threads, filePath)

  const lineToIndex = useMemo(() => {
    const map = new Map<DiffLine, number>()
    lines.forEach((line, i) => map.set(line, i))
    return map
  }, [lines])

  const cellBodyClass = (line: DiffLine | null, highlighted: boolean) => {
    if (highlighted) return 'bg-accent/15'
    if (!line) return 'bg-bg-tertiary/30'
    return ROW_BODY[line.type] || ''
  }

  const cellGutterClass = (line: DiffLine | null, highlighted: boolean) => {
    if (highlighted) return 'bg-accent/20 text-accent'
    if (!line) return 'bg-bg-tertiary/30'
    return ROW_GUTTER[line.type] || ''
  }

  const cellIndicatorClass = (line: DiffLine | null) => {
    if (!line) return ''
    return ROW_INDICATOR[line.type] || ''
  }

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 20,
    overscan: 20,
    measureElement: (el) => el.getBoundingClientRect().height,
  })

  return (
    <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
      {virtualizer.getVirtualItems().map((virtualRow) => {
        const i = virtualRow.index
        const row = rows[i]

        if (row.left?.type === 'expander' && row.left.expander) {
          return (
            <div
              key={i}
              ref={virtualizer.measureElement}
              data-index={i}
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${virtualRow.start}px)` }}
            >
              <ExpanderRow meta={row.left.expander} onExpand={onExpand ?? (() => {})} enabled={!!onExpand && !!expandEnabled} />
            </div>
          )
        }

        const isHunkRow = row.left?.type === 'hunk'
        const hunkId = row.left?.hunkId
        const isCollapsed = isHunkRow && hunkId != null && collapsedHunks.has(hunkId)
        const leftLineNum = row.left?.oldLine
        const rightLineNum = row.right?.newLine
        const canCommentLeft = onAddComment && leftLineNum != null && row.left && (row.left.type === 'delete' || row.left.type === 'context')
        const canCommentRight = onAddComment && rightLineNum != null && row.right && (row.right.type === 'add' || row.right.type === 'context')
        const leftRangePos = leftLineNum != null ? rangePosition(leftLineNum, 'LEFT') : 'none' as const
        const rightRangePos = rightLineNum != null ? rangePosition(rightLineNum, 'RIGHT') : 'none' as const
        const leftHighlighted = leftRangePos !== 'none'
        const rightHighlighted = rightRangePos !== 'none'

        const leftKey = leftLineNum != null ? `${leftLineNum}:LEFT` : ''
        const rightKey = rightLineNum != null ? `${rightLineNum}:RIGHT` : ''
        const leftThread = leftKey ? threadByLine.get(leftKey) : undefined
        const rightThread = rightKey ? threadByLine.get(rightKey) : undefined
        const leftOrphans = leftKey ? orphansByLine.get(leftKey) ?? [] : []
        const rightOrphans = rightKey ? orphansByLine.get(rightKey) ?? [] : []

        const showLeftForm = commentRange && commentRange.side === 'LEFT' && leftLineNum === commentRange.endLine
        const showRightForm = commentRange && commentRange.side === 'RIGHT' && rightLineNum === commentRange.endLine

        // The row's "type" for testing is whatever is shown on either side —
        // adds appear on the right, deletes on the left, contexts/hunks on both.
        const rowType = row.right?.type ?? row.left?.type ?? ''

        return (
          <div
            key={i}
            ref={virtualizer.measureElement}
            data-index={i}
            data-line-type={rowType || undefined}
            data-old-line={row.left?.oldLine ?? undefined}
            data-new-line={row.right?.newLine ?? undefined}
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${virtualRow.start}px)` }}
          >
            <div
              className={`group flex leading-5 ${isHunkRow ? 'cursor-pointer' : ''}`}
              onClick={isHunkRow && hunkId != null ? () => onToggleHunk(hunkId) : undefined}
              title={isHunkRow ? (isCollapsed ? 'Expand hunk' : 'Collapse hunk') : undefined}
            >
              <div
                className={`flex w-1/2 border-r border-border ${isHunkRow ? 'hover:bg-accent/15' : ''}`}
                onMouseEnter={() => leftLineNum != null && extendDrag(leftLineNum, 'LEFT')}
              >
                <span className={`flex shrink-0 ${cellGutterClass(row.left, leftHighlighted)}`}>
                  {isHunkRow ? (
                    <span className="w-5 text-center select-none">
                      {isCollapsed ? '▸' : '▾'}
                    </span>
                  ) : canCommentLeft ? (
                    <GutterButton lineNum={leftLineNum!} side="LEFT" rangePos={leftRangePos} onMouseDown={startDrag} onMouseEnter={extendDrag} />
                  ) : (
                    <span className="w-5" />
                  )}
                  <span className="w-10 text-right select-none pr-2 tabular-nums border-r border-border/40">
                    {row.left?.oldLine ?? ''}
                  </span>
                </span>
                <span className={`w-5 text-center select-none shrink-0 ${cellIndicatorClass(row.left)}`}>
                  {row.left?.type === 'delete' ? '−' : ''}
                </span>
                <pre className={`flex-1 whitespace-pre-wrap break-all pl-2 pr-2 ${cellBodyClass(row.left, leftHighlighted)}`}>
                  <HighlightedCode
                    tokens={row.left ? tokenMap?.get(lineToIndex.get(row.left)!) : undefined}
                    fallback={row.left?.content ?? ''}
                  />
                </pre>
              </div>
              <div
                className={`flex w-1/2 ${isHunkRow ? 'hover:bg-accent/15' : ''}`}
                onMouseEnter={() => rightLineNum != null && extendDrag(rightLineNum, 'RIGHT')}
              >
                <span className={`flex shrink-0 ${cellGutterClass(row.right, rightHighlighted)}`}>
                  {isHunkRow ? (
                    <span className="w-5" />
                  ) : canCommentRight ? (
                    <GutterButton lineNum={rightLineNum!} side="RIGHT" rangePos={rightRangePos} onMouseDown={startDrag} onMouseEnter={extendDrag} />
                  ) : (
                    <span className="w-5" />
                  )}
                  <span className="w-10 text-right select-none pr-2 tabular-nums border-r border-border/40">
                    {row.right?.newLine ?? ''}
                  </span>
                </span>
                <span className={`w-5 text-center select-none shrink-0 ${cellIndicatorClass(row.right)}`}>
                  {row.right?.type === 'add' ? '+' : ''}
                </span>
                <pre className={`flex-1 whitespace-pre-wrap break-all pl-2 pr-2 ${cellBodyClass(row.right, rightHighlighted)}`}>
                  <HighlightedCode
                    tokens={row.right ? tokenMap?.get(lineToIndex.get(row.right)!) : undefined}
                    fallback={row.right?.content ?? ''}
                  />
                </pre>
              </div>
            </div>
            {(leftThread || leftOrphans.length > 0 || showLeftForm) && (
              <div className="flex">
                <div className="w-1/2 border-r border-border">
                  {leftThread && (
                    <InlineThread
                      thread={leftThread}
                      onReply={onReplyThread}
                      onResolve={onResolveThread}
                      onUnresolve={onUnresolveThread}
                      onApplySuggestion={onApplySuggestion}
                    />
                  )}
                  {leftOrphans.map((c) => (
                    <OrphanComment key={c.id} comment={c} />
                  ))}
                  {showLeftForm && (
                    <InlineCommentForm
                      startLine={commentRange.startLine}
                      endLine={commentRange.endLine}
                      onSubmit={submitComment}
                      onCancel={cancelComment}
                    />
                  )}
                </div>
                <div className="w-1/2" />
              </div>
            )}
            {(rightThread || rightOrphans.length > 0 || showRightForm) && (
              <div className="flex">
                <div className="w-1/2 border-r border-border" />
                <div className="w-1/2">
                  {rightThread && (
                    <InlineThread
                      thread={rightThread}
                      onReply={onReplyThread}
                      onResolve={onResolveThread}
                      onUnresolve={onUnresolveThread}
                      onApplySuggestion={onApplySuggestion}
                    />
                  )}
                  {rightOrphans.map((c) => (
                    <OrphanComment key={c.id} comment={c} />
                  ))}
                  {showRightForm && (
                    <InlineCommentForm
                      startLine={commentRange.startLine}
                      endLine={commentRange.endLine}
                      onSubmit={submitComment}
                      onCancel={cancelComment}
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// --- Diff header with mode toggle ---

const DIFF_MODE_OPTIONS = [
  { value: 'unified' as DiffMode, label: 'Unified' },
  { value: 'split' as DiffMode, label: 'Split' },
]

function DiffHeader({
  filePath,
  mode,
  onModeChange,
  onCollapseAll,
  collapseAllLabel,
}: {
  filePath: string
  mode: DiffMode
  onModeChange: (m: DiffMode) => void
  onCollapseAll?: () => void
  collapseAllLabel?: string
}) {
  return (
    <div className="bg-bg-tertiary border-b border-border flex items-center justify-between" style={{ padding: '6px 12px' }}>
      <span className="text-xs text-text-muted truncate mr-3">{filePath}</span>
      <div className="flex items-center gap-2">
        {onCollapseAll && (
          <button
            className="text-[10px] text-text-muted hover:text-text rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            style={{ padding: '2px 6px' }}
            onClick={onCollapseAll}
            title={collapseAllLabel}
          >
            {collapseAllLabel}
          </button>
        )}
        <ToggleGroup options={DIFF_MODE_OPTIONS} value={mode} onChange={onModeChange} />
      </div>
    </div>
  )
}

// --- Main DiffViewer (for git tab, no comments) ---

export function DiffViewer({ repoPath }: { repoPath?: string }) {
  const { filePatch, selectedFilePath, selectedCommitHash, changedFiles } = useGitStore()
  const [mode, setMode] = useState<DiffMode>('unified')
  const scrollRef = useRef<HTMLDivElement>(null)
  const parsedLines = useMemo(() => (filePatch ? parsePatch(filePatch) : []), [filePatch])
  const [collapsedHunks, setCollapsedHunks] = useState<Set<number>>(new Set())

  // Lazily fetch the file contents that back "Show N unchanged lines" expansions.
  const { blobLines, expandedNewLines, handleExpand } = useExpandableBlob({
    repoPath: repoPath ?? null,
    filePath: selectedFilePath,
    commitHash: selectedCommitHash,
  })

  const displayLines = useMemo(
    () => buildDisplayLines(parsedLines, { expandedNewLines, blobLines, collapsedHunks }),
    [parsedLines, expandedNewLines, blobLines, collapsedHunks]
  )
  const tokenMap = useDiffHighlighting(displayLines, selectedFilePath, blobLines)
  const onToggleHunk = useCallback((id: number) => {
    setCollapsedHunks((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  const onCollapseAll = useCallback(() => {
    const all = new Set<number>()
    for (const l of parsedLines) {
      if (l.type === 'hunk' && l.hunkId != null) all.add(l.hunkId)
    }
    setCollapsedHunks(collapsedHunks.size === all.size ? new Set() : all)
  }, [parsedLines, collapsedHunks])

  if (!selectedFilePath) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-xs">
        Select a file to view diff
      </div>
    )
  }

  if (filePatch === null) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-xs">
        Loading...
      </div>
    )
  }

  if (repoPath && selectedFilePath && isImageFile(selectedFilePath) && selectedCommitHash) {
    const fileStatus = changedFiles.find((f) => f.filePath === selectedFilePath)?.status || 'modified'
    const isWorking = selectedCommitHash === WORKING_CHANGES_HASH
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <DiffHeader filePath={selectedFilePath} mode={mode} onModeChange={setMode} />
        <ImageDiffViewer
          repoPath={repoPath}
          filePath={selectedFilePath}
          status={fileStatus}
          beforeRef={isWorking ? 'HEAD' : `${selectedCommitHash}~1`}
          afterRef={isWorking ? null : selectedCommitHash}
        />
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <DiffHeader
        filePath={selectedFilePath}
        mode={mode}
        onModeChange={setMode}
        onCollapseAll={onCollapseAll}
        collapseAllLabel={collapsedHunks.size > 0 ? 'Expand all hunks' : 'Collapse hunks'}
      />
      <div ref={scrollRef} className="flex-1 overflow-auto font-mono text-xs">
        <DiffErrorBoundary filePath={selectedFilePath}>
          {mode === 'unified' ? (
            <UnifiedView
              lines={displayLines}
              comments={[]}
              threads={[]}
              filePath={null}
              tokenMap={tokenMap}
              onExpand={handleExpand}
              expandEnabled={true}
              collapsedHunks={collapsedHunks}
              onToggleHunk={onToggleHunk}
              scrollContainerRef={scrollRef}
            />
          ) : (
            <SplitView
              lines={displayLines}
              comments={[]}
              threads={[]}
              filePath={null}
              tokenMap={tokenMap}
              onExpand={handleExpand}
              expandEnabled={true}
              collapsedHunks={collapsedHunks}
              onToggleHunk={onToggleHunk}
              scrollContainerRef={scrollRef}
            />
          )}
        </DiffErrorBoundary>
      </div>
    </div>
  )
}

// --- PR DiffViewer (with comments, threads, expand-context, suggestions) ---

export interface PRDiffViewerProps {
  patch: string
  filePath: string
  comments: PRComment[]
  threads?: PRReviewThread[]
  onAddComment: (startLine: number, endLine: number, side: 'LEFT' | 'RIGHT', body: string) => void
  blobLines?: string[] | null
  expandedNewLines?: Set<number>
  onExpand?: (direction: 'up' | 'down' | 'all', meta: ExpanderMeta) => void | Promise<void>
  expandEnabled?: boolean
  onReplyThread?: (rootCommentId: number, body: string) => void | Promise<void>
  onResolveThread?: (threadId: string) => void | Promise<void>
  onUnresolveThread?: (threadId: string) => void | Promise<void>
  onApplySuggestion?: (startLine: number, endLine: number, newText: string, author: string) => void | Promise<void>
  initialMode?: DiffMode
}

export function PRDiffViewer({
  patch,
  filePath,
  comments,
  threads = [],
  onAddComment,
  blobLines,
  expandedNewLines,
  onExpand,
  expandEnabled,
  onReplyThread,
  onResolveThread,
  onUnresolveThread,
  onApplySuggestion,
  initialMode = 'split',
}: PRDiffViewerProps) {
  const [mode, setMode] = useState<DiffMode>(initialMode)
  const scrollRef = useRef<HTMLDivElement>(null)
  const parsedLines = useMemo(() => parsePatch(patch), [patch])
  const [collapsedHunks, setCollapsedHunks] = useState<Set<number>>(new Set())

  const displayLines = useMemo(
    () => buildDisplayLines(parsedLines, {
      expandedNewLines,
      blobLines: blobLines ?? null,
      collapsedHunks,
    }),
    [parsedLines, expandedNewLines, blobLines, collapsedHunks]
  )

  const tokenMap = useDiffHighlighting(displayLines, filePath, blobLines ?? null)

  const onToggleHunk = useCallback((id: number) => {
    setCollapsedHunks((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const onCollapseAll = useCallback(() => {
    const all = new Set<number>()
    for (const l of parsedLines) {
      if (l.type === 'hunk' && l.hunkId != null) all.add(l.hunkId)
    }
    setCollapsedHunks(collapsedHunks.size === all.size ? new Set() : all)
  }, [parsedLines, collapsedHunks])

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <DiffHeader
        filePath={filePath}
        mode={mode}
        onModeChange={setMode}
        onCollapseAll={onCollapseAll}
        collapseAllLabel={collapsedHunks.size > 0 ? 'Expand all hunks' : 'Collapse hunks'}
      />
      <div ref={scrollRef} className="flex-1 overflow-auto font-mono text-xs">
        <DiffErrorBoundary filePath={filePath}>
          {mode === 'unified' ? (
            <UnifiedView
              lines={displayLines}
              comments={comments}
              threads={threads}
              filePath={filePath}
              tokenMap={tokenMap}
              onAddComment={onAddComment}
              onExpand={onExpand}
              expandEnabled={expandEnabled}
              collapsedHunks={collapsedHunks}
              onToggleHunk={onToggleHunk}
              onReplyThread={onReplyThread}
              onResolveThread={onResolveThread}
              onUnresolveThread={onUnresolveThread}
              onApplySuggestion={onApplySuggestion}
              scrollContainerRef={scrollRef}
            />
          ) : (
            <SplitView
              lines={displayLines}
              comments={comments}
              threads={threads}
              filePath={filePath}
              tokenMap={tokenMap}
              onAddComment={onAddComment}
              onExpand={onExpand}
              expandEnabled={expandEnabled}
              collapsedHunks={collapsedHunks}
              onToggleHunk={onToggleHunk}
              onReplyThread={onReplyThread}
              onResolveThread={onResolveThread}
              onUnresolveThread={onUnresolveThread}
              onApplySuggestion={onApplySuggestion}
              scrollContainerRef={scrollRef}
            />
          )}
        </DiffErrorBoundary>
      </div>
    </div>
  )
}
