import React from 'react'
import { Tooltip } from '../ui'
import { CustomButtonBar } from '../buttons/CustomButtonBar'

interface RightActivityBarProps {
  activePanel: string | null
  onToggle: (panel: string) => void
  /** Unread Overseer messages — surfaced as a dot on its button. */
  overseerUnread?: number
}

export function RightActivityBar({
  activePanel,
  onToggle,
  overseerUnread = 0,
}: RightActivityBarProps) {
  return (
    <div
      className="flex flex-col items-center bg-bg-secondary border-l border-border flex-shrink-0"
      style={{ width: 44, paddingTop: 8 }}
    >
      <Tooltip content="Overseer" side="left">
        <button
          aria-label="Overseer"
          onClick={() => onToggle('overseer')}
          className={`w-8 h-8 rounded flex items-center justify-center transition-colors relative focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            activePanel === 'overseer'
              ? 'bg-accent/15 text-accent'
              : 'text-text-muted hover:text-text hover:bg-bg-tertiary'
          }`}
        >
          {/* Eye-over-nodes: one watcher above many workers */}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 8s3.5-4 10-4 10 4 10 4-3.5 4-10 4S2 8 2 8z" />
            <circle cx="12" cy="8" r="1.6" />
            <path d="M6 16v4" /><path d="M12 16v4" /><path d="M18 16v4" />
            <path d="M6 16h12" />
          </svg>
          {overseerUnread > 0 && activePanel !== 'overseer' && (
            <span
              className="absolute rounded-full"
              style={{
                top: 4,
                right: 4,
                width: 6,
                height: 6,
                background: 'var(--color-accent)',
              }}
            />
          )}
        </button>
      </Tooltip>

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

      <Tooltip content="Foundry" side="left">
        <button
          aria-label="Foundry"
          onClick={() => onToggle('foundry')}
          className={`w-8 h-8 rounded flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            activePanel === 'foundry'
              ? 'bg-accent/15 text-accent'
              : 'text-text-muted hover:text-text hover:bg-bg-tertiary'
          }`}
          style={{ marginTop: 4 }}
        >
          {/* Factory/forge icon */}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 21h18" />
            <path d="M3 21V11l5 3V11l5 3V11l5 3v7" />
            <path d="M7 17v.01" /><path d="M12 17v.01" /><path d="M17 17v.01" />
          </svg>
        </button>
      </Tooltip>

      {/* Custom buttons */}
      <CustomButtonBar placement="right-activity-bar" />
    </div>
  )
}
