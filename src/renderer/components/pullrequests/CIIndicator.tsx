import React from 'react'
import type { CIStatus } from '../../../shared/types'

export function CIIndicator({ status }: { status: CIStatus }) {
  if (status === 'none') return null
  if (status === 'success') {
    return (
      <svg
        aria-label="CI passed"
        className="shrink-0 w-2.5 h-2.5 text-success"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="3 8.5 6.5 12 13 5" />
      </svg>
    )
  }
  if (status === 'failure') {
    return (
      <svg
        aria-label="CI failed"
        className="shrink-0 w-2.5 h-2.5 text-danger"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <line x1="4" y1="4" x2="12" y2="12" />
        <line x1="12" y1="4" x2="4" y2="12" />
      </svg>
    )
  }
  return (
    <svg
      aria-label="CI running"
      className="shrink-0 w-2.5 h-2.5 text-warning animate-spin"
      viewBox="0 0 16 16"
      fill="none"
    >
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}
