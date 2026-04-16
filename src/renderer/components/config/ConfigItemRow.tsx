import React from 'react'
import { IconButton } from '../ui'
import type { ConfigItem, ConfigTrackingMode } from '../../../shared/types'

const TYPE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  command: { bg: 'bg-accent/15', text: 'text-accent', label: 'Command' },
  skill: { bg: 'bg-purple-500/15', text: 'text-purple-400', label: 'Skill' },
  hook: { bg: 'bg-warning/15', text: 'text-warning', label: 'Hook' },
  claudemd: { bg: 'bg-success/15', text: 'text-success', label: 'CLAUDE.md' },
  memory: { bg: 'bg-text-muted/15', text: 'text-text-muted', label: 'Memory' },
}

interface ConfigItemRowProps {
  item: ConfigItem
  onSelect: (itemId: string) => void
  onToggleTracking: (itemId: string, mode: ConfigTrackingMode) => void
  onDelete: (itemId: string) => void
}

export function ConfigItemRow({ item, onSelect, onToggleTracking, onDelete }: ConfigItemRowProps) {
  const style = TYPE_STYLES[item.type] ?? TYPE_STYLES.command
  const isShared = item.tracking === 'shared'
  const nextMode: ConfigTrackingMode = isShared ? 'local' : 'shared'

  return (
    <div
      role="option"
      aria-selected={false}
      tabIndex={0}
      onClick={() => onSelect(item.id)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(item.id) } }}
      className="flex items-center gap-2 group cursor-pointer hover:bg-bg-tertiary transition-colors"
      style={{ padding: '5px 8px 5px 12px' }}
    >
      <span
        className={`text-[10px] font-medium px-1.5 py-0.5 rounded flex-shrink-0 ${style.bg} ${style.text}`}
      >
        {style.label}
      </span>

      <span className="text-sm text-text truncate flex-1 min-w-0" title={item.relativePath}>
        {item.name}
      </span>

      {/* Toggle switch for Local/Shared */}
      <button
        role="switch"
        aria-checked={isShared}
        aria-label={isShared ? 'Shared with git — click to make local' : 'Local only — click to share with git'}
        onClick={(e) => { e.stopPropagation(); onToggleTracking(item.id, nextMode) }}
        className="flex items-center gap-1.5 flex-shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded px-1"
        title={isShared
          ? 'Shared — tracked by git. Click to make local only.'
          : 'Local only — not tracked by git. Click to share.'}
      >
        <span className={`text-[10px] ${isShared ? 'text-text-muted' : 'text-text'}`}>Local</span>
        {/* Track/pill toggle */}
        <span
          className={`relative inline-flex h-3.5 w-6 rounded-full transition-colors ${
            isShared ? 'bg-accent' : 'bg-border'
          }`}
        >
          <span
            className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-transform ${
              isShared ? 'translate-x-3' : 'translate-x-0.5'
            }`}
          />
        </span>
        <span className={`text-[10px] ${isShared ? 'text-text' : 'text-text-muted'}`}>Shared</span>
      </button>

      {/* Delete button */}
      {item.type !== 'hook' && (
        <IconButton
          label={`Delete ${item.name}`}
          variant="danger"
          onClick={(e) => { e.stopPropagation(); onDelete(item.id) }}
          className="opacity-0 group-hover:opacity-100 flex-shrink-0"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </IconButton>
      )}
    </div>
  )
}
