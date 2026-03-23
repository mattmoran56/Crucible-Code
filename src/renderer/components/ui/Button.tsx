import React from 'react'

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

const SIZE_CLASSES: Record<string, string> = {
  sm: 'px-3 py-1 text-xs',
  md: 'px-4 py-2 text-xs',
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      aria-disabled={disabled || loading || undefined}
      aria-busy={loading || undefined}
      className={`rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
      {...rest}
    >
      {loading ? 'Loading...' : children}
    </button>
  )
}
