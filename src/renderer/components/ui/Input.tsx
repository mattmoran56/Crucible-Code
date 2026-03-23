import React, { useId } from 'react'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string
  hint?: string
  error?: string
}

export function Input({ label, hint, error, className = '', ...rest }: InputProps) {
  const inputId = useId()
  const descId = useId()
  const hasDesc = !!(error || hint)

  return (
    <div className={className}>
      <label htmlFor={inputId} className="block text-xs text-text-muted mb-1.5">
        {label}
      </label>
      <input
        id={inputId}
        aria-describedby={hasDesc ? descId : undefined}
        aria-invalid={!!error || undefined}
        className={`w-full bg-bg border rounded-md text-xs text-text focus:outline-none ${
          error ? 'border-danger focus:border-danger' : 'border-border focus:border-accent'
        }`}
        style={{ padding: '8px 14px' }}
        {...rest}
      />
      {hasDesc && (
        <p
          id={descId}
          className={`text-[10px] mt-1 ${error ? 'text-danger' : 'text-text-muted'}`}
        >
          {error || hint}
        </p>
      )}
    </div>
  )
}
