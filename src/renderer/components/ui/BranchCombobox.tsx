import React, { useEffect, useId, useRef, useState, useMemo } from 'react'
import { createPortal } from 'react-dom'

interface BranchComboboxProps {
  label: string
  hint?: string
  value: string
  onChange: (value: string) => void
  onSelect: (branch: string) => void
  branches: string[]
  loading?: boolean
  placeholder?: string
  className?: string
  autoFocus?: boolean
  error?: string
}

export function BranchCombobox({
  label,
  hint,
  value,
  onChange,
  onSelect,
  branches,
  loading,
  placeholder,
  className = '',
  autoFocus,
  error,
}: BranchComboboxProps) {
  const inputId = useId()
  const listId = useId()
  const descId = useId()
  const hasDesc = !!(error || hint)

  const [open, setOpen] = useState(false)
  const [highlightIndex, setHighlightIndex] = useState(0)
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 })

  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    if (!value) return branches
    const lower = value.toLowerCase()
    return branches.filter((b) => b.toLowerCase().includes(lower))
  }, [branches, value])

  // Reset highlight when filtered list changes
  useEffect(() => {
    setHighlightIndex(0)
  }, [filtered.length, value])

  // Position the dropdown
  useEffect(() => {
    if (!open || !inputRef.current) return

    const update = () => {
      const rect = inputRef.current!.getBoundingClientRect()
      let top = rect.bottom + 2
      const left = rect.left
      const width = rect.width

      // Flip above if near bottom
      if (dropdownRef.current) {
        const dh = dropdownRef.current.getBoundingClientRect().height
        if (top + dh > window.innerHeight - 4) {
          top = rect.top - dh - 2
        }
      }

      setPos({ top, left, width })
    }

    update()
    // Reposition on scroll/resize
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [open, filtered.length])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handle = (e: MouseEvent) => {
      if (
        inputRef.current && !inputRef.current.contains(e.target as Node) &&
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  // Scroll highlighted item into view
  useEffect(() => {
    if (!open || !dropdownRef.current) return
    const item = dropdownRef.current.children[highlightIndex] as HTMLElement | undefined
    item?.scrollIntoView({ block: 'nearest' })
  }, [highlightIndex, open])

  const selectBranch = (branch: string) => {
    onSelect(branch)
    setOpen(false)
    inputRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        setOpen(true)
        e.preventDefault()
      }
      return
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setHighlightIndex((i) => Math.min(i + 1, filtered.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setHighlightIndex((i) => Math.max(i - 1, 0))
        break
      case 'Enter':
        e.preventDefault()
        if (filtered[highlightIndex]) {
          selectBranch(filtered[highlightIndex])
        }
        break
      case 'Escape':
        e.preventDefault()
        setOpen(false)
        break
    }
  }

  const activeDescendant = open && filtered.length > 0 ? `${listId}-${highlightIndex}` : undefined

  return (
    <div className={className}>
      <label htmlFor={inputId} className="block text-xs text-text-muted mb-1.5">
        {label}
      </label>
      <input
        ref={inputRef}
        id={inputId}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={activeDescendant}
        aria-describedby={hasDesc ? descId : undefined}
        aria-invalid={!!error || undefined}
        autoComplete="off"
        autoFocus={autoFocus}
        className={`w-full bg-bg border rounded-md text-xs text-text focus:outline-none ${
          error ? 'border-danger focus:border-danger' : 'border-border focus:border-accent'
        }`}
        style={{ padding: '8px 14px' }}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
      />
      {hasDesc && (
        <p
          id={descId}
          className={`text-[10px] mt-1 ${error ? 'text-danger' : 'text-text-muted'}`}
        >
          {error || hint}
        </p>
      )}

      {open && createPortal(
        <div
          ref={dropdownRef}
          id={listId}
          role="listbox"
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            width: pos.width,
            zIndex: 9999,
            maxHeight: 240,
            overflowY: 'auto',
          }}
          className="rounded border border-border bg-bg-secondary shadow-lg"
        >
          {loading ? (
            <div className="text-xs text-text-muted" style={{ padding: '8px 10px' }}>
              Loading branches...
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-xs text-text-muted" style={{ padding: '8px 10px' }}>
              No matching branches
            </div>
          ) : (
            filtered.map((branch, i) => (
              <div
                key={branch}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === highlightIndex}
                className={`text-xs cursor-pointer ${
                  i === highlightIndex ? 'bg-accent/15 text-accent' : 'text-text hover:bg-bg-tertiary'
                }`}
                style={{ padding: '6px 10px' }}
                onMouseEnter={() => setHighlightIndex(i)}
                onMouseDown={(e) => {
                  e.preventDefault() // prevent input blur
                  selectBranch(branch)
                }}
              >
                {branch}
              </div>
            ))
          )}
        </div>,
        document.body
      )}
    </div>
  )
}
