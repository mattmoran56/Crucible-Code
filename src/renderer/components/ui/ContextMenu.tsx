import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export interface ContextMenuItem {
  label: string
  onClick: () => void
  variant?: 'default' | 'danger'
  disabled?: boolean
  separatorAfter?: boolean
}

interface MenuState {
  x: number
  y: number
  items: ContextMenuItem[]
}

export interface UseContextMenuResult {
  onContextMenu: (e: React.MouseEvent, items: ContextMenuItem[]) => void
  menu: React.ReactNode
}

export function useContextMenu(): UseContextMenuResult {
  const [state, setState] = useState<MenuState | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  const onContextMenu = useCallback((e: React.MouseEvent, items: ContextMenuItem[]) => {
    if (items.length === 0) return
    e.preventDefault()
    e.stopPropagation()
    setState({ x: e.clientX, y: e.clientY, items })
    setPos(null)
  }, [])

  // Clamp menu inside viewport once it's measured.
  useEffect(() => {
    if (!state) return
    if (!ref.current) {
      setPos({ top: state.y, left: state.x })
      return
    }
    const rect = ref.current.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let left = state.x
    let top = state.y
    if (left + rect.width > vw - 4) left = Math.max(4, vw - rect.width - 4)
    if (top + rect.height > vh - 4) top = Math.max(4, vh - rect.height - 4)
    setPos({ top, left })
  }, [state])

  // Close on outside click / Escape / scroll.
  useEffect(() => {
    if (!state) return
    const close = () => setState(null)
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [state])

  const menu = state
    ? createPortal(
        <div
          ref={ref}
          role="menu"
          style={{
            position: 'fixed',
            top: pos?.top ?? state.y,
            left: pos?.left ?? state.x,
            visibility: pos ? 'visible' : 'hidden',
            zIndex: 9999,
            padding: '4px',
            minWidth: 180,
          }}
          className="rounded border border-border bg-bg-secondary shadow-lg"
        >
          {state.items.map((item, i) => (
            <React.Fragment key={`${item.label}-${i}`}>
              <button
                role="menuitem"
                disabled={item.disabled}
                onClick={(e) => {
                  e.stopPropagation()
                  setState(null)
                  if (!item.disabled) item.onClick()
                }}
                style={{ padding: '5px 10px', whiteSpace: 'nowrap' }}
                className={`w-full text-left text-xs rounded transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent disabled:opacity-50 disabled:cursor-not-allowed ${
                  item.variant === 'danger'
                    ? 'text-danger hover:bg-danger/10'
                    : 'text-text hover:bg-bg-tertiary'
                }`}
              >
                {item.label}
              </button>
              {item.separatorAfter && (
                <div className="border-t border-border my-1" role="separator" />
              )}
            </React.Fragment>
          ))}
        </div>,
        document.body
      )
    : null

  return { onContextMenu, menu }
}
