import React, { useState } from 'react'
import { useToastStore } from '../../stores/toastStore'

interface SuggestionBlockProps {
  text: string
  /** PR author / commenter — used for the apply commit message */
  author: string
  /** First line the suggestion replaces (1-based) */
  startLine: number
  /** Last line the suggestion replaces (1-based, inclusive) */
  endLine: number
  onApply?: (startLine: number, endLine: number, newText: string, author: string) => void | Promise<void>
}

export function SuggestionBlock({ text, author, startLine, endLine, onApply }: SuggestionBlockProps) {
  const [busy, setBusy] = useState(false)
  const lineLabel = startLine === endLine
    ? `Line ${startLine}`
    : `Lines ${startLine}–${endLine}`

  const handleApply = async () => {
    if (!onApply) return
    setBusy(true)
    try {
      await onApply(startLine, endLine, text, author)
    } finally {
      setBusy(false)
    }
  }

  const handleCopy = async () => {
    const { addToast } = useToastStore.getState()
    try {
      await navigator.clipboard.writeText(text)
      addToast('success', 'Suggestion copied')
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : String(err))
    }
  }

  const lines = text.split('\n')

  return (
    <div className="border border-border rounded my-2 overflow-hidden bg-bg">
      <div
        className="flex items-center gap-2 bg-bg-tertiary border-b border-border text-[10px] text-text-muted"
        style={{ padding: '4px 10px' }}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="text-accent">
          <path d="M2 4.75A2.75 2.75 0 0 1 4.75 2h6.5A2.75 2.75 0 0 1 14 4.75v6.5A2.75 2.75 0 0 1 11.25 14h-6.5A2.75 2.75 0 0 1 2 11.25v-6.5zm6.78.97a.75.75 0 0 0-1.06 0L4.97 8.47a.75.75 0 0 0 0 1.06l2.75 2.75a.75.75 0 1 0 1.06-1.06L7.06 9.5h4.19a.75.75 0 0 0 0-1.5H7.06l1.72-1.72a.75.75 0 0 0 0-1.06z" />
        </svg>
        <span className="font-medium text-text">Suggested change</span>
        <span>· {lineLabel}</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            className="text-text-muted hover:text-text rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            style={{ padding: '2px 6px' }}
            onClick={handleCopy}
            disabled={busy}
          >
            Copy
          </button>
          <button
            className="bg-accent text-white rounded hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
            style={{ padding: '2px 8px' }}
            onClick={handleApply}
            disabled={busy || !onApply}
            title={onApply ? 'Write change to worktree and commit' : 'Branch is not checked out — open in a worktree to apply'}
          >
            {busy ? 'Applying…' : 'Apply suggestion'}
          </button>
        </div>
      </div>
      <pre className="font-mono text-xs whitespace-pre-wrap break-all bg-bg" style={{ padding: '6px 10px' }}>
        {lines.map((l, i) => (
          <div key={i} className="bg-success/10">
            <span className="text-success select-none mr-1">+</span>
            {l || ' '}
          </div>
        ))}
      </pre>
    </div>
  )
}
