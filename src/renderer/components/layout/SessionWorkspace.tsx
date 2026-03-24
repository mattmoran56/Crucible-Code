import React, { useState } from 'react'
import { GitPanel } from '../git/GitPanel'
import { TerminalPanel } from '../terminal/TerminalPanel'

const TerminalIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" y1="19" x2="20" y2="19" />
  </svg>
)

const GitIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="18" cy="18" r="3" />
    <circle cx="6" cy="6" r="3" />
    <path d="M13 6h3a2 2 0 0 1 2 2v7" />
    <line x1="6" y1="9" x2="6" y2="21" />
  </svg>
)

type ViewTab = 'agent' | 'git'

export function SessionWorkspace() {
  const [activeTab, setActiveTab] = useState<ViewTab>('agent')

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Toolbar */}
      <div className="flex items-center bg-bg-tertiary border-b border-border" style={{ padding: '0 8px' }}>
        <WorkspaceTab
          active={activeTab === 'agent'}
          onClick={() => setActiveTab('agent')}
          icon={<TerminalIcon />}
          label="Agent"
        />
        <WorkspaceTab
          active={activeTab === 'git'}
          onClick={() => setActiveTab('git')}
          icon={<GitIcon />}
          label="Git"
        />
      </div>

      {/* Content — both panels always mounted, visibility toggled */}
      <div className="flex-1 flex flex-col min-h-0 relative">
        <div
          className="absolute inset-0 flex flex-col min-h-0"
          style={{
            visibility: activeTab === 'agent' ? 'visible' : 'hidden',
            pointerEvents: activeTab === 'agent' ? 'auto' : 'none',
            zIndex: activeTab === 'agent' ? 1 : 0,
          }}
        >
          <TerminalPanel mode="claude" visible={activeTab === 'agent'} />
        </div>
        <div
          className="absolute inset-0 flex min-h-0"
          style={{
            visibility: activeTab === 'git' ? 'visible' : 'hidden',
            pointerEvents: activeTab === 'git' ? 'auto' : 'none',
            zIndex: activeTab === 'git' ? 1 : 0,
          }}
        >
          <GitPanel />
        </div>
      </div>
    </div>
  )
}

function WorkspaceTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      onClick={onClick}
      role="tab"
      aria-selected={active}
      className={`flex items-center gap-1.5 text-xs transition-colors relative focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset ${
        active
          ? 'text-text'
          : 'text-text-muted hover:text-text'
      }`}
      style={{ padding: '8px 12px' }}
    >
      {icon}
      {label}
      {active && (
        <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent" />
      )}
    </button>
  )
}
