import React from 'react'
import { Tooltip } from '../ui'

interface RightActivityBarProps {
  activePanel: string | null
  onToggle: (panel: string) => void
}

export function RightActivityBar({ activePanel, onToggle }: RightActivityBarProps) {
  return (
    <div
      className="flex flex-col items-center bg-bg-secondary border-l border-border flex-shrink-0"
      style={{ width: 44, paddingTop: 8 }}
    >
      <Tooltip content="Notes" side="left">
        <button
          aria-label="Notes"
          onClick={() => onToggle('notes')}
          className={`w-8 h-8 rounded flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            activePanel === 'notes'
              ? 'bg-accent/15 text-accent'
              : 'text-text-muted hover:text-text hover:bg-bg-tertiary'
          }`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 6h4" /><path d="M2 10h4" /><path d="M2 14h4" /><path d="M2 18h4" />
            <rect x="6" y="4" width="16" height="16" rx="2" />
            <path d="M12 8v8" /><path d="M8 12h8" />
          </svg>
        </button>
      </Tooltip>
    </div>
  )
}
