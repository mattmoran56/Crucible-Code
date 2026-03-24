import React, { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  content: string
  children: React.ReactElement
}

export function Tooltip({ content, children }: Props) {
  const [visible, setVisible] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const triggerRef = useRef<HTMLElement>(null)

  const show = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setPos({
        top: rect.top - 6,
        left: rect.left + rect.width / 2,
      })
    }
    setVisible(true)
  }

  const hide = () => setVisible(false)

  const child = React.cloneElement(children, {
    ref: triggerRef,
    onMouseEnter: show,
    onMouseLeave: hide,
  })

  return (
    <>
      {child}
      {visible &&
        createPortal(
          <div
            className="fixed z-50 pointer-events-none"
            style={{ top: pos.top, left: pos.left, transform: 'translate(-50%, -100%)' }}
          >
            <div
              className="bg-bg-tertiary border border-border text-text text-[10px] rounded px-1.5 py-0.5 whitespace-nowrap shadow-lg"
              style={{ marginBottom: '4px' }}
            >
              {content}
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
