import React from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import { useWorkspaceLayoutStore } from '../../stores/workspaceLayoutStore'
import { GitPanelView } from './GitPanelView'

export function GitPanel() {
  const { activeSessionId, sessions } = useSessionStore()
  const activeSession = sessions.find((s) => s.id === activeSessionId)

  // Visible when any column has 'git' as its active tab
  const visible = useWorkspaceLayoutStore((s) =>
    s.columns.some((c) => c.activeTab === 'git')
  )

  if (!activeSession) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-xs">
        Select a session to view git history
      </div>
    )
  }

  return (
    <GitPanelView
      repoPath={activeSession.worktreePath}
      baseBranch={activeSession.baseBranch}
      sessionId={activeSession.id}
      visible={visible}
    />
  )
}
