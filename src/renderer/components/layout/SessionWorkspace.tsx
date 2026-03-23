import React from 'react'
import { GitPanel } from '../git/GitPanel'
import { TerminalPanel } from '../terminal/TerminalPanel'
import { PRReviewPanel } from '../pullrequests/PRReviewPanel'
import { useSessionStore } from '../../stores/sessionStore'

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

const PRIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="18" cy="18" r="3" />
    <circle cx="6" cy="6" r="3" />
    <path d="M13 6h3a2 2 0 0 1 2 2v7" />
    <path d="M6 9v12" />
    <path d="M18 15v-4a2 2 0 0 0-2-2h-3" />
  </svg>
)

export function SessionWorkspace() {
  const { activeWorkspaceTab, setActiveWorkspaceTab, activeSessionId, sessions } = useSessionStore()
  const activeSession = sessions.find((s) => s.id === activeSessionId)
  const hasPR = activeSession?.prNumber != null

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Toolbar */}
      <div className="flex items-center bg-bg-tertiary border-b border-border" style={{ padding: '0 8px' }}>
        <WorkspaceTab
          active={activeWorkspaceTab === 'agent'}
          onClick={() => setActiveWorkspaceTab('agent')}
          icon={<TerminalIcon />}
          label="Agent"
        />
        <WorkspaceTab
          active={activeWorkspaceTab === 'git'}
          onClick={() => setActiveWorkspaceTab('git')}
          icon={<GitIcon />}
          label="Git"
        />
        <WorkspaceTab
          active={activeWorkspaceTab === 'pr'}
          onClick={() => hasPR && setActiveWorkspaceTab('pr')}
          icon={<PRIcon />}
          label="PR"
          disabled={!hasPR}
        />
      </div>

      {/* Content — all panels always mounted, visibility toggled */}
      <div className="flex-1 flex flex-col min-h-0 relative">
        <div
          className="absolute inset-0 flex flex-col min-h-0"
          style={{
            visibility: activeWorkspaceTab === 'agent' ? 'visible' : 'hidden',
            pointerEvents: activeWorkspaceTab === 'agent' ? 'auto' : 'none',
            zIndex: activeWorkspaceTab === 'agent' ? 1 : 0,
          }}
        >
          <TerminalPanel mode="claude" visible={activeWorkspaceTab === 'agent'} />
        </div>
        <div
          className="absolute inset-0 flex min-h-0"
          style={{
            visibility: activeWorkspaceTab === 'git' ? 'visible' : 'hidden',
            pointerEvents: activeWorkspaceTab === 'git' ? 'auto' : 'none',
            zIndex: activeWorkspaceTab === 'git' ? 1 : 0,
          }}
        >
          <GitPanel />
        </div>
        <div
          className="absolute inset-0 flex min-h-0"
          style={{
            visibility: activeWorkspaceTab === 'pr' ? 'visible' : 'hidden',
            pointerEvents: activeWorkspaceTab === 'pr' ? 'auto' : 'none',
            zIndex: activeWorkspaceTab === 'pr' ? 1 : 0,
          }}
        >
          <PRReviewPanel />
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
  disabled,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  disabled?: boolean
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      role="tab"
      aria-selected={active}
      aria-disabled={disabled}
      className={`flex items-center gap-1.5 text-xs transition-colors relative focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset ${
        disabled
          ? 'text-text-muted/30 cursor-not-allowed'
          : active
            ? 'text-text'
            : 'text-text-muted hover:text-text'
      }`}
      style={{ padding: '8px 12px' }}
    >
      {icon}
      {label}
      {active && !disabled && (
        <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent" />
      )}
    </button>
  )
}
