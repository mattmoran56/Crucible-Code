import React from 'react'

interface TooltipProps {
  content: string
  children: React.ReactNode
  side?: 'top' | 'bottom' | 'left'
  className?: string
}

export function Tooltip({ content, children, side = 'top', className = '' }: TooltipProps) {
  const isTop = side === 'top'
  const isLeft = side === 'left'

  if (isLeft) {
    return (
      <div className={`relative inline-flex group/tooltip ${className}`}>
        {children}
        <span
          className={`
            absolute right-full top-1/2 -translate-y-1/2 mr-2 z-50
            px-2 py-1 rounded text-[10px] whitespace-nowrap pointer-events-none
            bg-bg-tertiary border border-border text-text shadow-lg
            opacity-0 group-hover/tooltip:opacity-100 transition-opacity duration-150
          `}
        >
          {content}
          <span
            className={`
              absolute left-full top-1/2 -translate-y-1/2 w-0 h-0
              border-y-4 border-y-transparent border-l-4 border-l-bg-tertiary
            `}
          />
        </span>
      </div>
    )
  }

  return (
    <div className={`relative inline-flex group/tooltip ${className}`}>
      {children}
      <span
        className={`
          absolute left-1/2 -translate-x-1/2 z-50
          px-2 py-1 rounded text-[10px] whitespace-nowrap pointer-events-none
          bg-bg-tertiary border border-border text-text shadow-lg
          opacity-0 group-hover/tooltip:opacity-100 transition-opacity duration-150
          ${isTop ? 'bottom-full mb-2' : 'top-full mt-2'}
        `}
      >
        {content}
        <span
          className={`
            absolute left-1/2 -translate-x-1/2 w-0 h-0
            border-x-4 border-x-transparent
            ${isTop
              ? 'top-full border-t-4 border-t-bg-tertiary'
              : 'bottom-full border-b-4 border-b-bg-tertiary'
            }
          `}
        />
      </span>
    </div>
  )
}
