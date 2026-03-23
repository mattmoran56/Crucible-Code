import React, { useEffect } from 'react'
import { useGitStore } from '../../stores/gitStore'
import { useSessionStore } from '../../stores/sessionStore'
import { CommitList } from './CommitList'
import { ChangedFiles } from './ChangedFiles'
import { DiffViewer } from './DiffViewer'

export function GitPanel() {
  const { activeSessionId, sessions } = useSessionStore()
  const { loadCommits, clear } = useGitStore()

  const activeSession = sessions.find((s) => s.id === activeSessionId)

  useEffect(() => {
    if (activeSession) {
      loadCommits(activeSession.worktreePath)
    } else {
      clear()
    }
  }, [activeSession?.id])

  if (!activeSession) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-xs">
        Select a session to view git history
      </div>
    )
  }

  return (
    <div className="flex-1 flex min-h-0">
      {/* Commit list */}
      <div className="w-72 border-r border-border flex flex-col min-h-0">
        <div className="px-3 py-1.5 bg-bg-tertiary border-b border-border text-xs text-text-muted flex items-center justify-between">
          <span>Commits</span>
          <button
            onClick={() => loadCommits(activeSession.worktreePath)}
            className="text-accent hover:text-accent-hover"
            title="Refresh"
          >
            ↻
          </button>
        </div>
        <CommitList repoPath={activeSession.worktreePath} />
      </div>

      {/* Changed files */}
      <div className="w-56 border-r border-border flex flex-col min-h-0">
        <div className="px-3 py-1.5 bg-bg-tertiary border-b border-border text-xs text-text-muted">
          Changed Files
        </div>
        <ChangedFiles repoPath={activeSession.worktreePath} />
      </div>

      {/* Diff viewer */}
      <div className="flex-1 flex flex-col min-h-0">
        <DiffViewer />
      </div>
    </div>
  )
}
