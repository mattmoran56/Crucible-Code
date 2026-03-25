import React, { useEffect, useState } from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import { useToastStore } from '../../stores/toastStore'
import type { Project, WorktreeInfo } from '../../../shared/types'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { ListBox, ListItem } from '../ui/ListBox'

interface Props {
  open: boolean
  project: Project
  onClose: () => void
}

export function ImportWorktreeDialog({ open, project, onClose }: Props) {
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const { sessions, staleSessions, importWorktree } = useSessionStore()

  useEffect(() => {
    if (!open) return
    setSelectedPath(null)
    setLoading(true)

    window.api.worktree.list(project.repoPath).then((all) => {
      const sessionPaths = new Set(
        [...sessions, ...staleSessions].map((s) => s.worktreePath)
      )
      // Filter out the main worktree (bare repo) and any already-tracked sessions
      const untracked = all.filter(
        (wt) => !sessionPaths.has(wt.path) && wt.path !== project.repoPath
      )
      setWorktrees(untracked)
      setLoading(false)
    })
  }, [open, project.repoPath, sessions, staleSessions])

  const handleImport = async () => {
    const wt = worktrees.find((w) => w.path === selectedPath)
    if (!wt) return
    setImporting(true)
    try {
      await importWorktree(project.id, wt)
      onClose()
    } catch (err) {
      const { addToast } = useToastStore.getState()
      addToast('error', err instanceof Error ? err.message : String(err))
    } finally {
      setImporting(false)
    }
  }

  // Derive a display name from the worktree path (last segment)
  const displayName = (wt: WorktreeInfo) => {
    const segments = wt.path.split('/')
    return segments[segments.length - 1] || wt.path
  }

  return (
    <Dialog open={open} onClose={onClose} title="Import Existing Worktree">
      {loading ? (
        <p className="text-text-muted text-xs text-center py-4">Loading worktrees...</p>
      ) : worktrees.length === 0 ? (
        <p className="text-text-muted text-xs text-center py-4">No untracked worktrees found</p>
      ) : (
        <ListBox label="Worktrees" className="max-h-60 overflow-y-auto mb-4">
          {worktrees.map((wt) => (
            <ListItem
              key={wt.path}
              selected={selectedPath === wt.path}
              onClick={() => setSelectedPath(wt.path)}
              style={{ padding: '8px 10px' }}
            >
              <div className="text-xs font-medium">{displayName(wt)}</div>
              <div className="text-[10px] text-text-muted mt-0.5">{wt.branch}</div>
            </ListItem>
          ))}
        </ListBox>
      )}

      <div className="flex gap-3 justify-end">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={handleImport}
          disabled={!selectedPath}
          loading={importing}
        >
          Import
        </Button>
      </div>
    </Dialog>
  )
}
