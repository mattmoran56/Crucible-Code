import React from 'react'
import { Tooltip } from '../ui'
import { CustomButtonBar } from '../buttons/CustomButtonBar'

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

      <Tooltip content="Usage" side="left">
        <button
          aria-label="Usage"
          onClick={() => onToggle('usage')}
          className={`w-8 h-8 rounded flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            activePanel === 'usage'
              ? 'bg-accent/15 text-accent'
              : 'text-text-muted hover:text-text hover:bg-bg-tertiary'
          }`}
          style={{ marginTop: 4 }}
        >
          {/* Gauge/speedometer icon */}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
            <path d="M12 6v2" />
            <path d="M6.93 8.93l1.41 1.41" />
            <path d="M6 14h2" />
            <path d="M14.5 9.5L12 12" />
          </svg>
        </button>
      </Tooltip>

      <Tooltip content="Permissions" side="left">
        <button
          aria-label="Permissions"
          onClick={() => onToggle('permissions')}
          className={`w-8 h-8 rounded flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            activePanel === 'permissions'
              ? 'bg-accent/15 text-accent'
              : 'text-text-muted hover:text-text hover:bg-bg-tertiary'
          }`}
          style={{ marginTop: 4 }}
        >
          {/* Shield icon */}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        </button>
      </Tooltip>

      <Tooltip content="Config" side="left">
        <button
          aria-label="Config"
          onClick={() => onToggle('config')}
          className={`w-8 h-8 rounded flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            activePanel === 'config'
              ? 'bg-accent/15 text-accent'
              : 'text-text-muted hover:text-text hover:bg-bg-tertiary'
          }`}
          style={{ marginTop: 4 }}
        >
          {/* Puzzle piece icon */}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.61a2.404 2.404 0 0 1-1.705.707 2.402 2.402 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.402 2.402 0 0 1 1.998 12c0-.617.236-1.234.706-1.704L4.23 8.77c.24-.24.581-.353.917-.303.515.077.877.528 1.073 1.01a2.5 2.5 0 1 0 3.259-3.259c-.482-.196-.933-.558-1.01-1.073-.05-.336.062-.676.303-.917l1.525-1.525A2.402 2.402 0 0 1 12 2c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02Z" />
          </svg>
        </button>
      </Tooltip>

      {/* Custom buttons */}
      <CustomButtonBar placement="right-activity-bar" />
    </div>
  )
}
