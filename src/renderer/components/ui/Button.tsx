import React from 'react'
import { cn } from '../../lib/cn'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  loading?: boolean
}

const VARIANT_CLASSES: Record<string, string> = {
  primary: 'bg-accent text-bg hover:bg-accent-hover disabled:opacity-50',
  ghost: 'text-text-muted hover:text-text',
  danger: 'bg-danger text-white hover:bg-danger/80',
}

const SIZE_STYLES: Record<string, React.CSSProperties> = {
  sm: { padding: '4px 10px', fontSize: '11px' },
  md: { padding: '6px 16px', fontSize: '12px' },
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className = '',
  style,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      aria-disabled={disabled || loading || undefined}
      aria-busy={loading || undefined}
      className={cn(
        'rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        VARIANT_CLASSES[variant],
        className
      )}
      style={{ ...SIZE_STYLES[size], ...style }}
      {...rest}
    >
      {loading ? 'Loading...' : children}
    </button>
  )
}
