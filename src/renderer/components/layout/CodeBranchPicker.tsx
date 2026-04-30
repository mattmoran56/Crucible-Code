import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PullRequest } from '../../../shared/types'
import { usePRStore } from '../../stores/prStore'

interface CodeBranchPickerProps {
  repoPath: string
  currentBranch: string
  /** Called when the user picks a branch other than the current one. */
  onSelect: (branch: string) => void
}

const PR_DOT_COLOR: Record<string, string> = {
  open: 'bg-success',
  draft: 'bg-text-muted',
  merged: 'bg-accent',
}

function prStateLabel(pr: PullRequest): 'open' | 'draft' | 'merged' {
  if (pr.state === 'MERGED') return 'merged'
  if (pr.isDraft) return 'draft'
  return 'open'
}

export function CodeBranchPicker({ repoPath, currentBranch, onSelect }: CodeBranchPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [branches, setBranches] = useState<string[]>([])
  const [defaultBranch, setDefaultBranch] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 })

  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const { pullRequests, loadPRs } = usePRStore()

  const prByBranch = useMemo(() => {
    const map = new Map<string, PullRequest>()
    for (const pr of pullRequests) {
      // Prefer non-merged PRs when a branch has multiple
      const existing = map.get(pr.headRefName)
      if (!existing || (existing.state === 'MERGED' && pr.state !== 'MERGED')) {
        map.set(pr.headRefName, pr)
      }
    }
    return map
  }, [pullRequests])

  const currentPR = prByBranch.get(currentBranch)

  // Load branches + default + refresh PRs when opened
  useEffect(() => {
    if (!open) return
    setLoading(true)
    setQuery('')
    Promise.all([
      window.api.git.listBranches(repoPath),
      window.api.git.defaultBranch(repoPath).catch(() => null),
      loadPRs(repoPath).catch(() => undefined),
    ])
      .then(([branchList, defBranch]) => {
        setBranches(branchList)
        setDefaultBranch(defBranch ?? null)
      })
      .catch(() => {
        setBranches([])
        setDefaultBranch(null)
      })
      .finally(() => {
        setLoading(false)
        setTimeout(() => inputRef.current?.focus(), 0)
      })
  }, [open, repoPath, loadPRs])

  // Position the dropdown beneath the trigger
  useEffect(() => {
    if (!open || !triggerRef.current) return
    const update = () => {
      const rect = triggerRef.current!.getBoundingClientRect()
      const width = Math.max(rect.width, 280)
      let top = rect.bottom + 4
      const left = Math.min(rect.left, window.innerWidth - width - 8)
      // Flip up if would overflow
      if (dropdownRef.current) {
        const dh = dropdownRef.current.getBoundingClientRect().height
        if (top + dh > window.innerHeight - 8) {
          top = rect.top - dh - 4
        }
      }
      setPos({ top, left, width })
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [open])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const t = e.target as Node
      if (
        triggerRef.current && !triggerRef.current.contains(t) &&
        dropdownRef.current && !dropdownRef.current.contains(t)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  // Build the ordered list: default (pinned) → current → rest, all filtered
  const items = useMemo(() => {
    const q = query.toLowerCase()
    const matches = (b: string) => b.toLowerCase().includes(q)

    const pinned: { branch: string; pinLabel?: string }[] = []
    const seen = new Set<string>()
    if (defaultBranch && branches.includes(defaultBranch) && matches(defaultBranch)) {
      pinned.push({ branch: defaultBranch, pinLabel: 'default' })
      seen.add(defaultBranch)
    }
    if (currentBranch && branches.includes(currentBranch) && !seen.has(currentBranch) && matches(currentBranch)) {
      pinned.push({ branch: currentBranch })
      seen.add(currentBranch)
    }

    const rest = branches.filter((b) => !seen.has(b) && matches(b))
    return { pinned, rest }
  }, [branches, defaultBranch, currentBranch, query])

  const handleSelect = (branch: string) => {
    setOpen(false)
    if (branch === currentBranch) return
    onSelect(branch)
  }

  const renderRow = (branch: string, pinLabel?: string) => {
    const pr = prByBranch.get(branch)
    const isCurrent = branch === currentBranch
    const stateKey = pr ? prStateLabel(pr) : null
    return (
      <div
        key={branch}
        role="option"
        aria-selected={isCurrent}
        onClick={() => handleSelect(branch)}
        className={`flex items-center gap-2 text-xs cursor-pointer transition-colors ${
          isCurrent ? 'bg-accent/15 text-text' : 'text-text-muted hover:bg-bg-tertiary hover:text-text'
        }`}
        style={{ padding: '6px 10px', minHeight: 28 }}
      >
        {/* Check for current branch (or spacer to keep alignment) */}
        <span className="flex-shrink-0 w-3 text-accent">
          {isCurrent ? (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : null}
        </span>
        <span className="flex-1 truncate font-mono">
          {branch}
          {pinLabel && (
            <span className="ml-1.5 text-[10px] text-text-muted">({pinLabel})</span>
          )}
        </span>
        {pr && stateKey && (
          <span className="flex-shrink-0 flex items-center gap-1 text-[10px] text-text-muted">
            <span>#{pr.number}</span>
            <span
              aria-label={stateKey}
              className={`inline-block w-1.5 h-1.5 rounded-full ${PR_DOT_COLOR[stateKey] ?? 'bg-text-muted'}`}
            />
          </span>
        )}
      </div>
    )
  }

  const triggerStateKey = currentPR ? prStateLabel(currentPR) : null

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        title={currentBranch}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="ml-auto flex items-center gap-1 text-text-muted hover:text-text hover:bg-bg-tertiary rounded transition-colors"
        style={{ padding: '2px 6px', maxWidth: 140 }}
      >
        <span className="text-[10px] truncate" style={{ maxWidth: 80 }}>
          {currentBranch}
        </span>
        {triggerStateKey && (
          <span
            aria-label={`PR ${triggerStateKey}`}
            className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${PR_DOT_COLOR[triggerStateKey] ?? 'bg-text-muted'}`}
          />
        )}
        <svg width="8" height="8" viewBox="0 0 8 8" className={`transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`}>
          <path d="M1 2.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>

      {open && createPortal(
        <div
          ref={dropdownRef}
          role="listbox"
          aria-label="Switch branch"
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            width: pos.width,
            zIndex: 9999,
          }}
          className="rounded border border-border bg-bg-secondary shadow-lg overflow-hidden"
        >
          {/* Search */}
          <div style={{ padding: '6px' }} className="border-b border-border">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search branches…"
              className="w-full bg-bg border border-border rounded text-xs text-text focus:outline-none focus:border-accent"
              style={{ padding: '5px 8px' }}
            />
          </div>

          {/* List */}
          <div className="overflow-y-auto" style={{ maxHeight: 320 }}>
            {loading ? (
              <div className="text-text-muted text-xs text-center" style={{ padding: '12px' }}>
                Loading branches…
              </div>
            ) : items.pinned.length === 0 && items.rest.length === 0 ? (
              <div className="text-text-muted text-xs text-center" style={{ padding: '12px' }}>
                No matching branches
              </div>
            ) : (
              <>
                {items.pinned.map((p) => renderRow(p.branch, p.pinLabel))}
                {items.pinned.length > 0 && items.rest.length > 0 && (
                  <div className="border-t border-border my-0.5" />
                )}
                {items.rest.map((b) => renderRow(b))}
              </>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
