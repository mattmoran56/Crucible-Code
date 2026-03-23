import React, { useEffect } from 'react'
import { useGitStore } from '../../stores/gitStore'
import { useSessionStore } from '../../stores/sessionStore'
import { CommitList } from './CommitList'
import { ChangedFiles } from './ChangedFiles'
import { DiffViewer } from './DiffViewer'
import { IconButton } from '../ui/IconButton'
import { ResizeHandle } from '../ui/ResizeHandle'
import { useResizable } from '../../hooks/useResizable'

export function GitPanel() {
  const { activeSessionId, sessions } = useSessionStore()
  const { loadCommits, clear } = useGitStore()

  const commitCol = useResizable({ direction: 'horizontal', initialSize: 288, minSize: 160, maxSize: 500 })
  const filesCol = useResizable({ direction: 'horizontal', initialSize: 224, minSize: 140, maxSize: 400 })

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
      <div style={{ width: commitCol.size }} className="flex-shrink-0 flex flex-col min-h-0">
        <div className="px-3 py-1.5 bg-bg-tertiary border-b border-border text-xs text-text-muted flex items-center justify-between">
          <span>Commits</span>
          <IconButton
            label="Refresh commits"
            onClick={() => loadCommits(activeSession.worktreePath)}
            className="text-accent hover:text-accent-hover"
          >
            ↻
          </IconButton>
        </div>
        <CommitList repoPath={activeSession.worktreePath} />
      </div>
      <ResizeHandle direction="horizontal" onMouseDown={commitCol.onMouseDown} />

      {/* Changed files */}
      <div style={{ width: filesCol.size }} className="flex-shrink-0 flex flex-col min-h-0">
        <div className="px-3 py-1.5 bg-bg-tertiary border-b border-border text-xs text-text-muted">
          Changed Files
        </div>
        <ChangedFiles repoPath={activeSession.worktreePath} />
      </div>
      <ResizeHandle direction="horizontal" onMouseDown={filesCol.onMouseDown} />

      {/* Diff viewer */}
      <div className="flex-1 flex flex-col min-h-0">
        <DiffViewer />
      </div>
    </div>
  )
}
