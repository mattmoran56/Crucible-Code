import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { IconButton } from '../ui/IconButton'
import {
  useSessionViewStore,
  type SessionSortKey,
  type SessionGroupKey,
} from '../../stores/sessionViewStore'

const SORT_OPTIONS: { key: SessionSortKey; label: string }[] = [
  { key: 'created', label: 'Created' },
  { key: 'name', label: 'Name' },
]

const GROUP_OPTIONS: { key: SessionGroupKey; label: string }[] = [
  { key: 'none', label: 'None' },
  { key: 'prStatus', label: 'PR Status' },
]

export function SessionSortMenu() {
  const { sortBy, groupBy, setSortBy, setGroupBy } = useSessionViewStore()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  useEffect(() => {
    if (!open) return

    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      let top = rect.bottom + 2
      let left = rect.right

      if (menuRef.current) {
        const menuRect = menuRef.current.getBoundingClientRect()
        const vw = window.innerWidth
        const vh = window.innerHeight
        const menuLeft = left - menuRect.width
        if (menuLeft < 4) left = menuRect.width + 4
        if (left > vw - 4) left = vw - 4
        if (top + menuRect.height > vh - 4) top = rect.top - menuRect.height - 2
      }

      setPos({ top, left })
    }

    function handleClick(e: MouseEvent) {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  const isNonDefault = sortBy !== 'created' || groupBy !== 'none'

  return (
    <>
      <div ref={triggerRef} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}>
        <IconButton
          label="Sort & group sessions"
          className={`text-sm ${isNonDefault ? 'text-accent' : 'text-text-muted hover:text-text'}`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="4" y1="6" x2="16" y2="6" />
            <line x1="4" y1="12" x2="12" y2="12" />
            <line x1="4" y1="18" x2="8" y2="18" />
          </svg>
        </IconButton>
      </div>
      {open && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, transform: 'translateX(-100%)', zIndex: 9998, padding: '6px 4px', minWidth: 140 }}
          className="rounded border border-border bg-bg-secondary shadow-lg"
        >
          <div className="text-[10px] text-text-muted uppercase tracking-wide font-medium px-2.5 pt-1 pb-1.5">
            Sort by
          </div>
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              style={{ padding: '5px 10px', whiteSpace: 'nowrap' }}
              className={`w-full text-left text-xs rounded transition-colors flex items-center gap-2 ${
                sortBy === opt.key ? 'text-accent' : 'text-text hover:bg-bg-tertiary'
              }`}
              onClick={(e) => { e.stopPropagation(); setSortBy(opt.key) }}
            >
              <span className="w-3 text-center">{sortBy === opt.key ? '✓' : ''}</span>
              {opt.label}
            </button>
          ))}
          <div className="border-t border-border my-1" />
          <div className="text-[10px] text-text-muted uppercase tracking-wide font-medium px-2.5 pt-1 pb-1.5">
            Group by
          </div>
          {GROUP_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              style={{ padding: '5px 10px', whiteSpace: 'nowrap' }}
              className={`w-full text-left text-xs rounded transition-colors flex items-center gap-2 ${
                groupBy === opt.key ? 'text-accent' : 'text-text hover:bg-bg-tertiary'
              }`}
              onClick={(e) => { e.stopPropagation(); setGroupBy(opt.key) }}
            >
              <span className="w-3 text-center">{groupBy === opt.key ? '✓' : ''}</span>
              {opt.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  )
}
