import React from 'react'
import { Tooltip } from './Tooltip'

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  size?: 'sm' | 'md'
  variant?: 'ghost' | 'danger'
  tooltipSide?: 'top' | 'bottom' | 'left'
  /** When true, spin the icon and disable the button to signal in-flight work. */
  loading?: boolean
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
  tooltipSide,
  className = '',
  loading = false,
  disabled,
  children,
  ...rest
}: IconButtonProps) {
  return (
    <Tooltip content={label} side={tooltipSide} className={className}>
      <button
        aria-label={label}
        aria-busy={loading || undefined}
        disabled={disabled || loading}
        className={`inline-flex items-center justify-center rounded transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60 ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]}`}
        {...rest}
      >
        {loading ? <span className="inline-flex animate-spin">{children}</span> : children}
      </button>
    </Tooltip>
  )
}
