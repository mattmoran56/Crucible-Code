import React, { useId } from 'react'
import { createPortal } from 'react-dom'
import { useFocusTrap } from '../../hooks/useFocusTrap'

interface DialogProps {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  width?: string
}

export function Dialog({ open, onClose, title, children, width = '24rem' }: DialogProps) {
  const titleId = useId()
  const containerRef = useFocusTrap(open)

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
        }}
        className="relative bg-bg-secondary border border-border shadow-2xl"
        style={{ width, padding: '16px 20px' }}
      >
        <h2 id={titleId} className="text-sm font-semibold mb-4">
          {title}
        </h2>
        {children}
      </div>
    </div>,
    document.body
  )
}
