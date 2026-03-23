import React, { useState } from 'react'
import { useGitStore } from '../../stores/gitStore'
import { ToggleGroup } from '../ui/ToggleGroup'
import type { PRComment } from '../../../shared/types'

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
      result.push({ type: 'context', content: line.startsWith(' ') ? line.slice(1) : line, oldLine: oldLine++, newLine: newLine++ })
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
      // Collect consecutive deletes and adds to pair them
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
  add: 'bg-success/10 text-success',
  delete: 'bg-danger/10 text-danger',
}

type DiffMode = 'unified' | 'split'

// --- Comment form inline ---

function InlineCommentForm({ onSubmit, onCancel }: { onSubmit: (body: string) => void; onCancel: () => void }) {
  const [text, setText] = useState('')
  return (
    <div className="flex gap-2 px-2 py-1.5 bg-bg-secondary border-y border-border">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Add a comment..."
        className="flex-1 bg-bg text-text text-xs font-mono border border-border rounded px-2 py-1 resize-none focus:outline-none focus:border-accent"
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
      <div className="flex flex-col gap-1">
        <button
          onClick={() => { if (text.trim()) onSubmit(text.trim()) }}
          className="text-[10px] px-2 py-0.5 bg-accent text-bg rounded hover:bg-accent-hover"
        >
          Comment
        </button>
        <button
          onClick={onCancel}
          className="text-[10px] px-2 py-0.5 text-text-muted hover:text-text"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// --- Inline comment display ---

function InlineComment({ comment }: { comment: PRComment }) {
  return (
    <div className="px-2 py-1.5 bg-bg-secondary border-y border-border">
      <div className="flex items-center gap-2 text-[10px] text-text-muted mb-1">
        <span className="font-medium text-text">{comment.author}</span>
        <span>{new Date(comment.createdAt).toLocaleDateString()}</span>
      </div>
      <div className="text-xs text-text whitespace-pre-wrap">{comment.body}</div>
    </div>
  )
}

// --- Unified diff view ---

function UnifiedView({
  lines,
  comments,
  filePath,
  onAddComment,
  commentingLine,
  setCommentingLine,
}: {
  lines: DiffLine[]
  comments: PRComment[]
  filePath: string | null
  onAddComment?: (line: number, body: string) => void
  commentingLine: number | null
  setCommentingLine: (line: number | null) => void
}) {
  return (
    <div>
      {lines.map((line, i) => {
        const lineNum = line.newLine ?? line.oldLine
        const lineComments = filePath
          ? comments.filter((c) => c.path === filePath && c.line === lineNum)
          : []

        return (
          <React.Fragment key={i}>
            <div
              className={`group flex px-2 leading-5 ${LINE_STYLES[line.type] || ''}`}
            >
              <span className="w-10 text-right text-text-muted/50 select-none pr-2 shrink-0">
                {line.oldLine ?? ''}
              </span>
              <span className="w-10 text-right text-text-muted/50 select-none pr-2 shrink-0">
                {line.newLine ?? ''}
              </span>
              <span className="w-4 text-center select-none shrink-0">
                {line.type === 'add' ? '+' : line.type === 'delete' ? '-' : ''}
              </span>
              <pre className="flex-1 whitespace-pre-wrap break-all">{line.content}</pre>
              {onAddComment && line.newLine != null && (
                <button
                  onClick={() => setCommentingLine(line.newLine!)}
                  className="opacity-0 group-hover:opacity-100 text-accent text-[10px] px-1 shrink-0"
                  title="Add comment"
                >
                  +
                </button>
              )}
            </div>
            {lineComments.map((c) => (
              <InlineComment key={c.id} comment={c} />
            ))}
            {commentingLine === lineNum && lineNum != null && onAddComment && (
              <InlineCommentForm
                onSubmit={(body) => {
                  onAddComment(lineNum, body)
                  setCommentingLine(null)
                }}
                onCancel={() => setCommentingLine(null)}
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
  onAddComment,
  commentingLine,
  setCommentingLine,
}: {
  lines: DiffLine[]
  comments: PRComment[]
  filePath: string | null
  onAddComment?: (line: number, body: string) => void
  commentingLine: number | null
  setCommentingLine: (line: number | null) => void
}) {
  const rows = toSplitRows(lines)

  const cellStyle = (line: DiffLine | null) => {
    if (!line) return 'bg-bg-tertiary/30'
    return LINE_STYLES[line.type] || ''
  }

  return (
    <div>
      {rows.map((row, i) => {
        const rightLineNum = row.right?.newLine
        const lineComments = filePath && rightLineNum != null
          ? comments.filter((c) => c.path === filePath && c.line === rightLineNum)
          : []

        return (
          <React.Fragment key={i}>
            <div className="group flex leading-5">
              {/* Left side */}
              <div className={`flex w-1/2 border-r border-border px-2 ${cellStyle(row.left)}`}>
                <span className="w-10 text-right text-text-muted/50 select-none pr-2 shrink-0">
                  {row.left?.oldLine ?? ''}
                </span>
                <span className="w-4 text-center select-none shrink-0">
                  {row.left?.type === 'delete' ? '-' : ''}
                </span>
                <pre className="flex-1 whitespace-pre-wrap break-all">{row.left?.content ?? ''}</pre>
              </div>
              {/* Right side */}
              <div className={`flex w-1/2 px-2 ${cellStyle(row.right)}`}>
                <span className="w-10 text-right text-text-muted/50 select-none pr-2 shrink-0">
                  {row.right?.newLine ?? ''}
                </span>
                <span className="w-4 text-center select-none shrink-0">
                  {row.right?.type === 'add' ? '+' : ''}
                </span>
                <pre className="flex-1 whitespace-pre-wrap break-all">{row.right?.content ?? ''}</pre>
                {onAddComment && row.right?.newLine != null && (
                  <button
                    onClick={() => setCommentingLine(row.right!.newLine!)}
                    className="opacity-0 group-hover:opacity-100 text-accent text-[10px] px-1 shrink-0"
                    title="Add comment"
                  >
                    +
                  </button>
                )}
              </div>
            </div>
            {lineComments.map((c) => (
              <InlineComment key={c.id} comment={c} />
            ))}
            {commentingLine === rightLineNum && rightLineNum != null && onAddComment && (
              <InlineCommentForm
                onSubmit={(body) => {
                  onAddComment(rightLineNum, body)
                  setCommentingLine(null)
                }}
                onCancel={() => setCommentingLine(null)}
              />
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

function DiffHeader({ filePath, mode, onModeChange }: { filePath: string; mode: DiffMode; onModeChange: (m: DiffMode) => void }) {
  return (
    <div
      className="bg-bg-tertiary border-b border-border flex items-center justify-between"
      style={{ padding: '6px 12px' }}
    >
      <span className="text-xs text-text-muted truncate mr-3">{filePath}</span>
      <ToggleGroup options={DIFF_MODE_OPTIONS} value={mode} onChange={onModeChange} />
    </div>
  )
}

// --- Main DiffViewer (for git tab, no comments) ---

export function DiffViewer() {
  const { filePatch, selectedFilePath } = useGitStore()
  const [mode, setMode] = useState<DiffMode>('unified')

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

  const lines = parsePatch(filePatch)

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <DiffHeader filePath={selectedFilePath} mode={mode} onModeChange={setMode} />
      <div className="flex-1 overflow-auto font-mono text-xs">
        {mode === 'unified' ? (
          <UnifiedView lines={lines} comments={[]} filePath={null} commentingLine={null} setCommentingLine={() => {}} />
        ) : (
          <SplitView lines={lines} comments={[]} filePath={null} commentingLine={null} setCommentingLine={() => {}} />
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
  onAddComment: (line: number, body: string) => void
}) {
  const [mode, setMode] = useState<DiffMode>('split')
  const [commentingLine, setCommentingLine] = useState<number | null>(null)
  const lines = parsePatch(patch)

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <DiffHeader filePath={filePath} mode={mode} onModeChange={setMode} />
      <div className="flex-1 overflow-auto font-mono text-xs">
        {mode === 'unified' ? (
          <UnifiedView
            lines={lines}
            comments={comments}
            filePath={filePath}
            onAddComment={onAddComment}
            commentingLine={commentingLine}
            setCommentingLine={setCommentingLine}
          />
        ) : (
          <SplitView
            lines={lines}
            comments={comments}
            filePath={filePath}
            onAddComment={onAddComment}
            commentingLine={commentingLine}
            setCommentingLine={setCommentingLine}
          />
        )}
      </div>
    </div>
  )
}
