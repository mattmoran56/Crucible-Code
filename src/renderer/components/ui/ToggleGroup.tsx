import React from 'react'

interface ToggleOption<T extends string> {
  value: T
  label: string
}

interface ToggleGroupProps<T extends string> {
  options: ToggleOption<T>[]
  value: T
  onChange: (value: T) => void
  className?: string
}

export function ToggleGroup<T extends string>({
  options,
  value,
  onChange,
  className = '',
}: ToggleGroupProps<T>) {
  return (
    <div
      className={`inline-flex rounded-md border border-border overflow-hidden ${className}`}
      role="radiogroup"
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={`transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset ${
              active
                ? 'bg-accent text-bg'
                : 'bg-bg-secondary text-text-muted hover:text-text hover:bg-bg-tertiary'
            }`}
            style={{ padding: '4px 12px', fontSize: '11px' }}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
