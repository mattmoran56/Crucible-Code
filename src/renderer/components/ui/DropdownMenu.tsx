import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export interface MenuItem {
  label: string
  variant?: 'default' | 'danger'
  onClick: () => void
}

interface DropdownMenuProps {
  items: MenuItem[]
  children: React.ReactElement
}

export function DropdownMenu({ items, children }: DropdownMenuProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  // Reposition after first render so we can measure the menu
  useEffect(() => {
    if (!open) return

    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      // Initial position: right-aligned below the trigger
      let top = rect.bottom + 2
      let left = rect.right

      // Clamp to viewport once menu is measured
      if (menuRef.current) {
        const menuRect = menuRef.current.getBoundingClientRect()
        const vw = window.innerWidth
        const vh = window.innerHeight
        // The menu is translated -100% so its right edge sits at `left`
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

  return (
    <>
      <div
        ref={triggerRef}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
      >
        {children}
      </div>
      {open && createPortal(
        <div
          ref={menuRef}
          role="menu"
          style={{ position: 'fixed', top: pos.top, left: pos.left, transform: 'translateX(-100%)', zIndex: 9998, padding: '6px 4px' }}
          className="rounded border border-border bg-bg-secondary shadow-lg"
        >
          {items.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}
              className={`w-full text-left text-xs rounded transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${
                item.variant === 'danger'
                  ? 'text-danger hover:bg-danger/10'
                  : 'text-text hover:bg-bg-tertiary'
              }`}
              onClick={(e) => {
                e.stopPropagation()
                setOpen(false)
                item.onClick()
              }}
            >
              {item.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  )
}
