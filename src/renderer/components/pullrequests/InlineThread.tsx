import React, { useMemo, useState } from 'react'
import { marked } from 'marked'
import type { PRComment, PRReviewThread } from '../../../shared/types'
import { SuggestionBlock } from './SuggestionBlock'

marked.setOptions({ breaks: true })

function formatTime(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

const SUGGESTION_REGEX = /```suggestion\n([\s\S]*?)\n?```/g

interface SuggestionContext {
  /** First line of the comment range */
  startLine: number
  /** Last line of the comment range */
  endLine: number
  /** Username — used in the apply commit message */
  author: string
}

interface SegmentedBody {
  segments: Array<{ kind: 'markdown'; html: string } | { kind: 'suggestion'; text: string }>
}

function segmentBody(body: string): SegmentedBody {
  const segments: SegmentedBody['segments'] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  const re = new RegExp(SUGGESTION_REGEX.source, 'g')
  while ((match = re.exec(body)) !== null) {
    const before = body.slice(lastIndex, match.index)
    if (before.trim()) {
      segments.push({ kind: 'markdown', html: marked.parse(before) as string })
    }
    segments.push({ kind: 'suggestion', text: match[1] ?? '' })
    lastIndex = match.index + match[0].length
  }
  const tail = body.slice(lastIndex)
  if (tail.trim()) {
    segments.push({ kind: 'markdown', html: marked.parse(tail) as string })
  }
  if (segments.length === 0) {
    segments.push({ kind: 'markdown', html: marked.parse(body) as string })
  }
  return { segments }
}

function CommentBubble({
  comment,
  suggestionCtx,
  onApplySuggestion,
}: {
  comment: PRComment
  suggestionCtx?: SuggestionContext
  onApplySuggestion?: (startLine: number, endLine: number, newText: string, author: string) => void | Promise<void>
}) {
  const segmented = useMemo(() => segmentBody(comment.body), [comment.body])

  return (
    <div className="border-b border-border last:border-b-0" style={{ padding: '8px 12px' }}>
      <div className="flex items-center gap-2 text-[10px] text-text-muted mb-1">
        <span className="font-semibold text-text">{comment.author}</span>
        <span>&middot;</span>
        <span>{formatTime(comment.createdAt)}</span>
      </div>
      <div className="markdown-body">
        {segmented.segments.map((seg, i) =>
          seg.kind === 'markdown' ? (
            <div key={i} dangerouslySetInnerHTML={{ __html: seg.html }} />
          ) : (
            <SuggestionBlock
              key={i}
              text={seg.text}
              author={comment.author}
              startLine={suggestionCtx?.startLine ?? comment.startLine ?? comment.line ?? 0}
              endLine={suggestionCtx?.endLine ?? comment.line ?? 0}
              onApply={onApplySuggestion}
            />
          )
        )}
      </div>
    </div>
  )
}

export function InlineThread({
  thread,
  onReply,
  onResolve,
  onUnresolve,
  onApplySuggestion,
}: {
  thread: PRReviewThread
  onReply?: (rootCommentId: number, body: string) => void | Promise<void>
  onResolve?: (threadId: string) => void | Promise<void>
  onUnresolve?: (threadId: string) => void | Promise<void>
  onApplySuggestion?: (startLine: number, endLine: number, newText: string, author: string) => void | Promise<void>
}) {
  const [expanded, setExpanded] = useState(!thread.isResolved)
  const [replyText, setReplyText] = useState('')
  const [showReply, setShowReply] = useState(false)
  const [busy, setBusy] = useState(false)

  const root = thread.comments[0]
  const ctx: SuggestionContext = {
    startLine: thread.startLine ?? thread.line ?? 0,
    endLine: thread.line ?? 0,
    author: root?.author ?? 'reviewer',
  }

  const handleReply = async () => {
    if (!root || !onReply || !replyText.trim()) return
    setBusy(true)
    try {
      await onReply(root.id, replyText.trim())
      setReplyText('')
      setShowReply(false)
    } finally {
      setBusy(false)
    }
  }

  const handleResolveToggle = async () => {
    if (!thread.id) return
    setBusy(true)
    try {
      if (thread.isResolved) {
        await onUnresolve?.(thread.id)
      } else {
        await onResolve?.(thread.id)
      }
    } finally {
      setBusy(false)
    }
  }

  // Resolved + collapsed: show single-line summary.
  if (thread.isResolved && !expanded) {
    return (
      <div
        className="flex items-center gap-2 bg-bg-secondary border-y border-border text-[10px] text-text-muted"
        style={{ padding: '4px 12px', marginLeft: '20px' }}
      >
        <span>Resolved · {thread.comments.length} {thread.comments.length === 1 ? 'comment' : 'comments'}</span>
        <button
          className="ml-auto text-accent hover:underline focus:outline-none"
          onClick={() => setExpanded(true)}
        >
          Expand
        </button>
      </div>
    )
  }

  return (
    <div
      className="bg-bg-secondary border-y border-border"
      style={{ marginLeft: '20px' }}
    >
      <div className="flex items-center gap-2 bg-bg-tertiary border-b border-border text-[10px] text-text-muted" style={{ padding: '4px 12px' }}>
        <span>{thread.isResolved ? 'Resolved thread' : `${thread.comments.length} ${thread.comments.length === 1 ? 'comment' : 'comments'}`}</span>
        {thread.isResolved && (
          <button
            className="text-text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
            style={{ padding: '0 4px' }}
            onClick={() => setExpanded(false)}
          >
            Hide
          </button>
        )}
      </div>
      {thread.comments.map((c) => (
        <CommentBubble
          key={c.id}
          comment={c}
          suggestionCtx={ctx}
          onApplySuggestion={onApplySuggestion}
        />
      ))}
      <div className="flex items-center gap-2 bg-bg-tertiary border-t border-border text-[10px]" style={{ padding: '4px 12px' }}>
        {onReply && root && (
          <button
            className="text-text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
            style={{ padding: '2px 6px' }}
            onClick={() => setShowReply((v) => !v)}
            disabled={busy}
          >
            {showReply ? 'Cancel' : 'Reply'}
          </button>
        )}
        {(onResolve || onUnresolve) && thread.id && (
          <button
            className={`ml-auto rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              thread.isResolved
                ? 'text-text-muted hover:text-text'
                : 'text-success hover:text-success/80'
            }`}
            style={{ padding: '2px 6px' }}
            onClick={handleResolveToggle}
            disabled={busy}
          >
            {thread.isResolved ? 'Unresolve' : 'Resolve'}
          </button>
        )}
      </div>
      {showReply && (
        <div className="bg-bg-secondary border-t border-border" style={{ padding: '8px 12px' }}>
          <textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Reply to this thread…"
            rows={2}
            autoFocus
            className="w-full bg-bg text-text text-xs font-mono border border-border rounded resize-none focus:outline-none focus:border-accent"
            style={{ padding: '6px 10px' }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                handleReply()
              }
              if (e.key === 'Escape') setShowReply(false)
            }}
          />
          <div className="flex justify-end gap-2 mt-1.5">
            <button
              className="text-text-muted text-[10px] rounded hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              style={{ padding: '3px 8px' }}
              onClick={() => setShowReply(false)}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              className="bg-accent text-white text-[10px] rounded hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
              style={{ padding: '3px 8px' }}
              onClick={handleReply}
              disabled={busy || !replyText.trim()}
            >
              {busy ? 'Replying…' : 'Reply'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** A standalone comment that isn't part of a structured review thread (e.g. older REST comments). */
export function OrphanComment({
  comment,
  onApplySuggestion,
}: {
  comment: PRComment
  onApplySuggestion?: (startLine: number, endLine: number, newText: string, author: string) => void | Promise<void>
}) {
  return (
    <div className="bg-bg-secondary border-y border-border" style={{ marginLeft: '20px' }}>
      <CommentBubble comment={comment} onApplySuggestion={onApplySuggestion} />
    </div>
  )
}
