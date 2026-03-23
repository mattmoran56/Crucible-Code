import React from 'react'

interface ResizeHandleProps {
  direction: 'horizontal' | 'vertical'
  onMouseDown: (e: React.MouseEvent) => void
}

export function ResizeHandle({ direction, onMouseDown }: ResizeHandleProps) {
  const isHorizontal = direction === 'horizontal'

  return (
    <div
      onMouseDown={onMouseDown}
      className={`relative flex-shrink-0 bg-border hover:bg-accent/40 transition-colors ${
        isHorizontal ? 'w-[3px] cursor-col-resize' : 'h-[3px] cursor-row-resize'
      }`}
      role="separator"
      aria-orientation={isHorizontal ? 'vertical' : 'horizontal'}
      tabIndex={0}
      onKeyDown={(e) => {
        // Keyboard resizing not implemented yet, but the element is focusable
        // for accessibility compliance
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
    />
  )
}
