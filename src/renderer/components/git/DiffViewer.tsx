import React, { useState, useCallback, useRef, useMemo } from 'react'
import { useGitStore, WORKING_CHANGES_HASH } from '../../stores/gitStore'
import { ToggleGroup } from '../ui/ToggleGroup'
import { Button } from '../ui/Button'
import { marked } from 'marked'
import { useDiffHighlighting, type TokenMap } from '../../hooks/useDiffHighlighting'
import type { ThemedToken } from 'shiki'
import type { PRComment } from '../../../shared/types'
import { ImageDiffViewer, isImageFile } from './ImageDiffViewer'

// Configure marked for inline rendering
marked.setOptions({ breaks: true })

// --- Patch parsing ---

interface DiffLine {
  type: 'header' | 'context' | 'add' | 'delete' | 'hunk'
  content: string
  oldLine?: number
  newLine?: number
}

export function parsePatch(patch: string): DiffLine[] {
  const lines = patch.split('\n')
  const result: DiffLine[] = []

  let oldLine = 0
  let newLine = 0
  let inDiff = false

  for (const line of lines) {
    if (line.startsWith('@@')) {
      inDiff = true
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      if (match) {
        oldLine = parseInt(match[1], 10)
        newLine = parseInt(match[2], 10)
      }
      result.push({ type: 'hunk', content: line })
    } else if (!inDiff) {
      result.push({ type: 'header', content: line })
    } else if (line.startsWith('+')) {
      result.push({ type: 'add', content: line.slice(1), newLine: newLine++ })
    } else if (line.startsWith('-')) {
      result.push({ type: 'delete', content: line.slice(1), oldLine: oldLine++ })
    } else {
      result.push({
        type: 'context',
        content: line.startsWith(' ') ? line.slice(1) : line,
        oldLine: oldLine++,
        newLine: newLine++,
      })
    }
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

    if (line.type === 'header' || line.type === 'hunk') {
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

// --- Styles ---

const LINE_STYLES: Record<string, string> = {
  header: 'text-text-muted bg-bg-tertiary',
  hunk: 'text-accent bg-accent/5',
  context: '',
  add: 'bg-success/10',
  delete: 'bg-danger/10',
}

const INDICATOR_STYLES: Record<string, string> = {
  add: 'text-success',
  delete: 'text-danger',
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
    // Check active drag first, then settled comment range
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

  const isInRange = useCallback((lineNum: number, side: 'LEFT' | 'RIGHT') => {
    return rangePosition(lineNum, side) !== 'none'
  }, [rangePosition])

  const cancelComment = useCallback(() => {
    setCommentRange(null)
  }, [])

  const submitComment = useCallback((body: string) => {
    if (!commentRange || !onAddComment) return
    onAddComment(commentRange.startLine, commentRange.endLine, commentRange.side, body)
    setCommentRange(null)
  }, [commentRange, onAddComment])

  return { dragRange, commentRange, startDrag, extendDrag, isInRange, rangePosition, cancelComment, submitComment }
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
      {/* Vertical selection bar */}
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
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              if (text.trim()) onSubmit(text.trim())
            }}
          >
            Comment
          </Button>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  )
}

// --- Inline comment display ---

function formatTime(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function InlineComment({ comment }: { comment: PRComment }) {
  const html = useMemo(() => marked.parse(comment.body) as string, [comment.body])

  return (
    <div className="px-3 py-2 bg-bg-secondary border-y border-border" style={{ marginLeft: '20px' }}>
      <div className="flex items-center gap-2 text-[10px] text-text-muted mb-2">
        <span className="font-semibold text-text">{comment.author}</span>
        <span>&middot;</span>
        <span>{formatTime(comment.createdAt)}</span>
      </div>
      <div
        className="markdown-body"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}

// --- Unified diff view ---

function UnifiedView({
  lines,
  comments,
  filePath,
  tokenMap,
  onAddComment,
}: {
  lines: DiffLine[]
  comments: PRComment[]
  filePath: string | null
  tokenMap: TokenMap | null
  onAddComment?: (startLine: number, endLine: number, side: 'LEFT' | 'RIGHT', body: string) => void
}) {
  const { commentRange, startDrag, extendDrag, rangePosition, cancelComment, submitComment } = useLineDrag(onAddComment)

  return (
    <div>
      {lines.map((line, i) => {
        const lineNum = line.newLine ?? line.oldLine
        const canComment = onAddComment && lineNum != null && (line.type === 'add' || line.type === 'delete' || line.type === 'context')
        const side: 'LEFT' | 'RIGHT' = line.type === 'delete' ? 'LEFT' : 'RIGHT'
        const rangePos = lineNum != null ? rangePosition(lineNum, side) : 'none' as const
        const highlighted = rangePos !== 'none'
        const lineComments = filePath
          ? comments.filter((c) => c.path === filePath && c.line === lineNum)
          : []
        const showForm = commentRange && lineNum === commentRange.endLine && commentRange.side === side

        return (
          <React.Fragment key={i}>
            <div
              className={`group flex px-2 leading-5 ${LINE_STYLES[line.type] || ''} ${highlighted ? 'bg-accent/15' : ''}`}
              onMouseEnter={() => lineNum != null && extendDrag(lineNum, side)}
            >
              {canComment ? (
                <GutterButton lineNum={lineNum!} side={side} rangePos={rangePos} onMouseDown={startDrag} onMouseEnter={extendDrag} />
              ) : (
                <span className="w-5 shrink-0" />
              )}
              <span className="w-10 text-right text-text-muted/50 select-none pr-2 shrink-0">
                {line.oldLine ?? ''}
              </span>
              <span className="w-10 text-right text-text-muted/50 select-none pr-2 shrink-0">
                {line.newLine ?? ''}
              </span>
              <span className={`w-4 text-center select-none shrink-0 ${INDICATOR_STYLES[line.type] || ''}`}>
                {line.type === 'add' ? '+' : line.type === 'delete' ? '-' : ''}
              </span>
              <pre className="flex-1 whitespace-pre-wrap break-all">
                <HighlightedCode tokens={tokenMap?.get(i)} fallback={line.content} />
              </pre>
            </div>
            {lineComments.map((c) => (
              <InlineComment key={c.id} comment={c} />
            ))}
            {showForm && (
              <InlineCommentForm
                startLine={commentRange.startLine}
                endLine={commentRange.endLine}
                onSubmit={submitComment}
                onCancel={cancelComment}
              />
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}

// --- Split diff view ---

function SplitView({
  lines,
  comments,
  filePath,
  tokenMap,
  onAddComment,
}: {
  lines: DiffLine[]
  comments: PRComment[]
  filePath: string | null
  tokenMap: TokenMap | null
  onAddComment?: (startLine: number, endLine: number, side: 'LEFT' | 'RIGHT', body: string) => void
}) {
  const rows = toSplitRows(lines)
  const { commentRange, startDrag, extendDrag, rangePosition, cancelComment, submitComment } = useLineDrag(onAddComment)

  // Map DiffLine references back to original indices for token lookup
  const lineToIndex = useMemo(() => {
    const map = new Map<DiffLine, number>()
    lines.forEach((line, i) => map.set(line, i))
    return map
  }, [lines])

  const cellStyle = (line: DiffLine | null, highlighted: boolean) => {
    if (highlighted) return 'bg-accent/15'
    if (!line) return 'bg-bg-tertiary/30'
    return LINE_STYLES[line.type] || ''
  }

  return (
    <div>
      {rows.map((row, i) => {
        const leftLineNum = row.left?.oldLine
        const rightLineNum = row.right?.newLine
        const canCommentLeft = onAddComment && leftLineNum != null && row.left && (row.left.type === 'delete' || row.left.type === 'context')
        const canCommentRight = onAddComment && rightLineNum != null && row.right && (row.right.type === 'add' || row.right.type === 'context')
        const leftRangePos = leftLineNum != null ? rangePosition(leftLineNum, 'LEFT') : 'none' as const
        const rightRangePos = rightLineNum != null ? rangePosition(rightLineNum, 'RIGHT') : 'none' as const
        const leftHighlighted = leftRangePos !== 'none'
        const rightHighlighted = rightRangePos !== 'none'

        const leftComments = filePath && leftLineNum != null
          ? comments.filter((c) => c.path === filePath && c.line === leftLineNum && c.side === 'LEFT')
          : []
        const rightComments = filePath && rightLineNum != null
          ? comments.filter((c) => c.path === filePath && c.line === rightLineNum && (c.side === 'RIGHT' || !c.side))
          : []

        const showLeftForm = commentRange && commentRange.side === 'LEFT' && leftLineNum === commentRange.endLine
        const showRightForm = commentRange && commentRange.side === 'RIGHT' && rightLineNum === commentRange.endLine

        return (
          <React.Fragment key={i}>
            <div className="group flex leading-5">
              {/* Left side */}
              <div
                className={`flex w-1/2 border-r border-border px-2 ${cellStyle(row.left, leftHighlighted)}`}
                onMouseEnter={() => leftLineNum != null && extendDrag(leftLineNum, 'LEFT')}
              >
                {canCommentLeft ? (
                  <GutterButton lineNum={leftLineNum!} side="LEFT" rangePos={leftRangePos} onMouseDown={startDrag} onMouseEnter={extendDrag} />
                ) : (
                  <span className="w-5 shrink-0" />
                )}
                <span className="w-10 text-right text-text-muted/50 select-none pr-2 shrink-0">
                  {row.left?.oldLine ?? ''}
                </span>
                <span className={`w-4 text-center select-none shrink-0 ${row.left ? INDICATOR_STYLES[row.left.type] || '' : ''}`}>
                  {row.left?.type === 'delete' ? '-' : ''}
                </span>
                <pre className="flex-1 whitespace-pre-wrap break-all">
                  <HighlightedCode
                    tokens={row.left ? tokenMap?.get(lineToIndex.get(row.left)!) : undefined}
                    fallback={row.left?.content ?? ''}
                  />
                </pre>
              </div>
              {/* Right side */}
              <div
                className={`flex w-1/2 px-2 ${cellStyle(row.right, rightHighlighted)}`}
                onMouseEnter={() => rightLineNum != null && extendDrag(rightLineNum, 'RIGHT')}
              >
                {canCommentRight ? (
                  <GutterButton lineNum={rightLineNum!} side="RIGHT" rangePos={rightRangePos} onMouseDown={startDrag} onMouseEnter={extendDrag} />
                ) : (
                  <span className="w-5 shrink-0" />
                )}
                <span className="w-10 text-right text-text-muted/50 select-none pr-2 shrink-0">
                  {row.right?.newLine ?? ''}
                </span>
                <span className={`w-4 text-center select-none shrink-0 ${row.right ? INDICATOR_STYLES[row.right.type] || '' : ''}`}>
                  {row.right?.type === 'add' ? '+' : ''}
                </span>
                <pre className="flex-1 whitespace-pre-wrap break-all">
                  <HighlightedCode
                    tokens={row.right ? tokenMap?.get(lineToIndex.get(row.right)!) : undefined}
                    fallback={row.right?.content ?? ''}
                  />
                </pre>
              </div>
            </div>
            {/* Left-side comments/form */}
            {(leftComments.length > 0 || showLeftForm) && (
              <div className="flex">
                <div className="w-1/2 border-r border-border">
                  {leftComments.map((c) => (
                    <InlineComment key={c.id} comment={c} />
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
            {/* Right-side comments/form */}
            {(rightComments.length > 0 || showRightForm) && (
              <div className="flex">
                <div className="w-1/2 border-r border-border" />
                <div className="w-1/2">
                  {rightComments.map((c) => (
                    <InlineComment key={c.id} comment={c} />
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
          </React.Fragment>
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
}: {
  filePath: string
  mode: DiffMode
  onModeChange: (m: DiffMode) => void
}) {
  return (
    <div className="bg-bg-tertiary border-b border-border flex items-center justify-between" style={{ padding: '6px 12px' }}>
      <span className="text-xs text-text-muted truncate mr-3">{filePath}</span>
      <ToggleGroup options={DIFF_MODE_OPTIONS} value={mode} onChange={onModeChange} />
    </div>
  )
}

// --- Main DiffViewer (for git tab, no comments) ---

export function DiffViewer({ repoPath }: { repoPath?: string }) {
  const { filePatch, selectedFilePath, selectedCommitHash, changedFiles } = useGitStore()
  const [mode, setMode] = useState<DiffMode>('unified')
  const lines = useMemo(() => (filePatch ? parsePatch(filePatch) : []), [filePatch])
  const tokenMap = useDiffHighlighting(lines, selectedFilePath)

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

  // Image files: show visual preview instead of text diff
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
      <DiffHeader filePath={selectedFilePath} mode={mode} onModeChange={setMode} />
      <div className="flex-1 overflow-auto font-mono text-xs">
        {mode === 'unified' ? (
          <UnifiedView lines={lines} comments={[]} filePath={null} tokenMap={tokenMap} />
        ) : (
          <SplitView lines={lines} comments={[]} filePath={null} tokenMap={tokenMap} />
        )}
      </div>
    </div>
  )
}

// --- PR DiffViewer (with comments and add-comment support) ---

export function PRDiffViewer({
  patch,
  filePath,
  comments,
  onAddComment,
}: {
  patch: string
  filePath: string
  comments: PRComment[]
  onAddComment: (startLine: number, endLine: number, side: 'LEFT' | 'RIGHT', body: string) => void
}) {
  const [mode, setMode] = useState<DiffMode>('split')
  const lines = useMemo(() => parsePatch(patch), [patch])
  const tokenMap = useDiffHighlighting(lines, filePath)

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <DiffHeader filePath={filePath} mode={mode} onModeChange={setMode} />
      <div className="flex-1 overflow-auto font-mono text-xs">
        {mode === 'unified' ? (
          <UnifiedView lines={lines} comments={comments} filePath={filePath} tokenMap={tokenMap} onAddComment={onAddComment} />
        ) : (
          <SplitView lines={lines} comments={comments} filePath={filePath} tokenMap={tokenMap} onAddComment={onAddComment} />
        )}
      </div>
    </div>
  )
}
