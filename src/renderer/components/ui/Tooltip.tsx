import React, { useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface TooltipProps {
  content: string
  children: React.ReactNode
  side?: 'top' | 'bottom' | 'left'
  className?: string
}

export function Tooltip({ content, children, side = 'top', className = '' }: TooltipProps) {
  const [visible, setVisible] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const ref = useRef<HTMLDivElement>(null)

  function show() {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    if (side === 'left') {
      setPos({ top: rect.top + rect.height / 2, left: rect.left - 8 })
    } else if (side === 'top') {
      setPos({ top: rect.top - 8, left: rect.left + rect.width / 2 })
    } else {
      setPos({ top: rect.bottom + 8, left: rect.left + rect.width / 2 })
    }
    setVisible(true)
  }

  const transform =
    side === 'left'
      ? 'translate(-100%, -50%)'
      : side === 'top'
        ? 'translate(-50%, -100%)'
        : 'translate(-50%, 0)'

  return (
    <div
      ref={ref}
      className={`relative inline-flex ${className}`}
      onMouseEnter={show}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {visible &&
        createPortal(
          <span
            style={{
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              transform,
              zIndex: 9999,
              pointerEvents: 'none',
              padding: '5px 10px',
            }}
            className="rounded text-[10px] whitespace-nowrap bg-bg-tertiary border border-border text-text shadow-lg"
          >
            {content}
          </span>,
          document.body
        )}
    </div>
  )
}
