import React, { useMemo } from 'react'
import { marked } from 'marked'
import { usePRReviewStore } from '../../stores/prReviewStore'
import type { PRCheck, PRConversationComment, PRDetail } from '../../../shared/types'

marked.setOptions({ breaks: true })

const CheckIcon = ({ conclusion }: { conclusion: PRCheck['conclusion'] }) => {
  if (conclusion === 'success') {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="text-success flex-shrink-0">
        <path d="M8 16A8 8 0 1 1 8 0a8 8 0 0 1 0 16zm3.78-9.72a.75.75 0 0 0-1.06-1.06L6.75 9.19 5.28 7.72a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0l4.5-4.5z" />
      </svg>
    )
  }
  if (conclusion === 'failure') {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="text-danger flex-shrink-0">
        <path d="M8 16A8 8 0 1 1 8 0a8 8 0 0 1 0 16zm3.03-11.03a.75.75 0 0 0-1.06 0L8 6.94 6.03 4.97a.75.75 0 0 0-1.06 1.06L6.94 8 4.97 9.97a.75.75 0 1 0 1.06 1.06L8 9.06l1.97 1.97a.75.75 0 0 0 1.06-1.06L9.06 8l1.97-1.97a.75.75 0 0 0 0-1.06z" />
      </svg>
    )
  }
  if (conclusion === 'skipped' || conclusion === 'neutral') {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="text-text-muted flex-shrink-0">
        <path d="M8 16A8 8 0 1 1 8 0a8 8 0 0 1 0 16zM4.5 7.25a.75.75 0 0 0 0 1.5h7a.75.75 0 0 0 0-1.5h-7z" />
      </svg>
    )
  }
  // Pending / in progress - spinner
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="text-warning flex-shrink-0 animate-spin">
      <path d="M8 0a8 8 0 1 0 8 8h-1.5A6.5 6.5 0 1 1 8 1.5V0z" />
    </svg>
  )
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString()
}

function ChecksSection({ checks, polling }: { checks: PRCheck[]; polling: boolean }) {
  if (checks.length === 0) {
    return (
      <div className="text-xs text-text-muted" style={{ padding: '8px 0' }}>
        No checks configured
      </div>
    )
  }

  const passed = checks.filter((c) => c.conclusion === 'success').length
  const failed = checks.filter((c) => c.conclusion === 'failure').length
  const pending = checks.filter((c) => c.status !== 'completed').length

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-medium text-text">
          Checks
        </span>
        <span className="text-[10px] text-text-muted">
          {passed} passed
          {failed > 0 && <>, <span className="text-danger">{failed} failed</span></>}
          {pending > 0 && <>, <span className="text-warning">{pending} pending</span></>}
        </span>
        {polling && (
          <span className="text-[10px] text-text-muted flex items-center gap-1">
            <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" className="animate-spin">
              <path d="M8 0a8 8 0 1 0 8 8h-1.5A6.5 6.5 0 1 1 8 1.5V0z" />
            </svg>
            polling
          </span>
        )}
      </div>
      <div className="flex flex-col gap-0.5">
        {checks.map((check) => (
          <div
            key={check.name}
            className="flex items-center gap-2 text-xs rounded"
            style={{ padding: '4px 8px' }}
          >
            <CheckIcon conclusion={check.status === 'completed' ? check.conclusion : null} />
            <span className="truncate flex-1 text-text">{check.name}</span>
            {check.completedAt && (
              <span className="text-[10px] text-text-muted flex-shrink-0">
                {formatDate(check.completedAt)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function MarkdownBody({ body }: { body: string }) {
  const html = useMemo(() => marked.parse(body) as string, [body])
  return (
    <div
      className="markdown-body"
      style={{ padding: '8px 10px' }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function CommentCard({ comment }: { comment: PRConversationComment }) {
  return (
    <div className="border border-border rounded" style={{ marginBottom: '8px' }}>
      <div
        className="flex items-center gap-2 bg-bg-tertiary border-b border-border text-xs"
        style={{ padding: '6px 10px' }}
      >
        <span className="font-medium text-text">{comment.author}</span>
        <span className="text-text-muted">{formatDate(comment.createdAt)}</span>
      </div>
      <MarkdownBody body={comment.body} />
    </div>
  )
}

function PRBody({ detail }: { detail: PRDetail }) {
  return (
    <div className="border border-border rounded" style={{ marginBottom: '12px' }}>
      <div
        className="flex items-center gap-2 bg-bg-tertiary border-b border-border text-xs"
        style={{ padding: '6px 10px' }}
      >
        <span className="font-medium text-text">{detail.author}</span>
        <span className="text-text-muted">opened {formatDate(detail.createdAt)}</span>
        <span className="text-text-muted ml-auto font-mono text-[10px]">
          {detail.headRefName} → {detail.baseRefName}
        </span>
      </div>
      {detail.body ? (
        <MarkdownBody body={detail.body} />
      ) : (
        <div className="text-xs text-text-muted italic" style={{ padding: '8px 10px' }}>
          No description provided.
        </div>
      )}
    </div>
  )
}

export function PRConversationTab() {
  const { detail, conversationComments, checks, checksPolling } = usePRReviewStore()

  return (
    <div className="flex-1 overflow-y-auto" style={{ padding: '12px 16px' }}>
      {/* PR description */}
      {detail && <PRBody detail={detail} />}

      {/* Checks */}
      <div style={{ marginBottom: '12px' }}>
        <ChecksSection checks={checks} polling={checksPolling} />
      </div>

      {/* Conversation comments */}
      {conversationComments.length > 0 && (
        <div>
          <div className="text-xs font-medium text-text" style={{ marginBottom: '8px' }}>
            Comments ({conversationComments.length})
          </div>
          {conversationComments.map((comment) => (
            <CommentCard key={comment.id} comment={comment} />
          ))}
        </div>
      )}

      {conversationComments.length === 0 && (
        <div className="text-xs text-text-muted" style={{ padding: '8px 0' }}>
          No comments yet
        </div>
      )}
    </div>
  )
}
