import React from 'react'
import { Tooltip } from './Tooltip'

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  size?: 'sm' | 'md'
  variant?: 'ghost' | 'danger'
}

const VARIANT_CLASSES: Record<string, string> = {
  ghost: 'text-text-muted hover:text-text',
  danger: 'text-danger hover:text-danger/80',
}

const SIZE_CLASSES: Record<string, string> = {
  sm: 'w-6 h-6',
  md: 'w-8 h-8',
}

export function IconButton({
  label,
  size = 'sm',
  variant = 'ghost',
  className = '',
  children,
  ...rest
}: IconButtonProps) {
  return (
    <Tooltip content={label}>
      <button
        aria-label={label}
        className={`inline-flex items-center justify-center rounded transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
        {...rest}
      >
        {children}
      </button>
    </Tooltip>
  )
}
