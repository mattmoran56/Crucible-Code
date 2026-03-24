import React, { useEffect, useState, useMemo } from 'react'
import { useGitStore } from '../../stores/gitStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useToastStore } from '../../stores/toastStore'
import { CommitList } from './CommitList'
import { ChangedFiles } from './ChangedFiles'
import { DiffViewer } from './DiffViewer'
import { ResizeHandle } from '../ui/ResizeHandle'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { useResizable } from '../../hooks/useResizable'

const POLL_INTERVAL = 3_000

// ── Toolbar icons ──────────────────────────────────────────────────────────

const PushIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 19V5" />
    <path d="M5 12l7-7 7 7" />
    <path d="M5 20h14" />
  </svg>
)

const OpenPRIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="18" cy="18" r="3" />
    <circle cx="6" cy="6" r="3" />
    <path d="M13 6h3a2 2 0 0 1 2 2v7" />
    <path d="M6 9v12" />
    <path d="M18 15v-4a2 2 0 0 0-2-2h-3" />
    <path d="M11 19l2 2 4-4" />
  </svg>
)

const MergeIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="6" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M6 9v6" />
    <path d="M18 18a3 3 0 0 0-3-3H9" />
    <circle cx="18" cy="18" r="3" />
  </svg>
)

// ── Toolbar button ─────────────────────────────────────────────────────────

function ToolbarBtn({
  icon,
  label,
  onClick,
  loading = false,
  disabled = false,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  loading?: boolean
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className="flex items-center gap-1.5 text-[11px] text-text-muted hover:text-text disabled:opacity-40 disabled:cursor-default transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-accent rounded"
      style={{ padding: '4px 8px' }}
    >
      {icon}
      {loading ? 'Working…' : label}
    </button>
  )
}

// ── Merge dialog ───────────────────────────────────────────────────────────

function MergeDialog({
  open,
  onClose,
  repoPath,
}: {
  open: boolean
  onClose: () => void
  repoPath: string
}) {
  const { addToast } = useToastStore.getState()
  const { loadCommits, loadWorkingFiles, loadCommitStatuses } = useGitStore()

  const [query, setQuery] = useState('')
  const [branches, setBranches] = useState<string[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [checkResult, setCheckResult] = useState<{ hasConflicts: boolean } | null>(null)
  const [merging, setMerging] = useState(false)

  // Load branches when dialog opens
  useEffect(() => {
    if (!open) return
    setQuery('')
    setSelected(null)
    setCheckResult(null)
    window.api.git.listBranches(repoPath).then(setBranches).catch(() => setBranches([]))
  }, [open, repoPath])

  // Check for conflicts when a branch is selected
  useEffect(() => {
    if (!selected) { setCheckResult(null); return }
    setChecking(true)
    setCheckResult(null)
    window.api.git.mergeCheck(repoPath, selected)
      .then((result) => setCheckResult(result))
      .catch(() => setCheckResult({ hasConflicts: true }))
      .finally(() => setChecking(false))
  }, [selected, repoPath])

  const filtered = useMemo(
    () => branches.filter((b) => b.toLowerCase().includes(query.toLowerCase())),
    [branches, query]
  )

  const handleMerge = async () => {
    if (!selected) return
    setMerging(true)
    try {
      await window.api.git.merge(repoPath, selected)
      addToast('success', `Merged ${selected}`)
      loadCommits(repoPath)
      loadWorkingFiles(repoPath)
      loadCommitStatuses(repoPath)
      onClose()
    } catch (err: any) {
      addToast('error', err.message)
    } finally {
      setMerging(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Merge branch into current" width="28rem">
      {/* Search input */}
      <div className="relative mb-2">
        <input
          autoFocus
          value={query}
          onChange={(e) => { setQuery(e.target.value); setSelected(null) }}
          placeholder="Search branches…"
          className="w-full bg-bg border border-border rounded text-xs text-text focus:outline-none focus:border-accent"
          style={{ padding: '7px 12px' }}
        />
      </div>

      {/* Branch list */}
      <div
        className="border border-border rounded overflow-y-auto mb-3"
        style={{ height: '180px' }}
        role="listbox"
        aria-label="Branches"
      >
        {filtered.length === 0 ? (
          <div className="p-3 text-text-muted text-xs text-center">No branches found</div>
        ) : (
          filtered.map((b) => (
            <div
              key={b}
              role="option"
              aria-selected={selected === b}
              onClick={() => setSelected(b)}
              className={`px-3 py-1.5 text-xs cursor-pointer transition-colors ${
                selected === b
                  ? 'bg-accent/15 text-text'
                  : 'text-text-muted hover:bg-bg-tertiary hover:text-text'
              }`}
            >
              {b}
            </div>
          ))
        )}
      </div>

      {/* Status area */}
      <div className="mb-4 min-h-[20px]">
        {selected && checking && (
          <p className="text-text-muted text-xs">Checking for conflicts…</p>
        )}
        {selected && !checking && checkResult && (
          checkResult.hasConflicts ? (
            <p className="text-danger text-xs">
              Merge conflicts detected — resolve manually before merging.
            </p>
          ) : (
            <p className="text-success text-xs">No conflicts — safe to merge.</p>
          )
        )}
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
        <Button
          size="sm"
          disabled={!selected || checking || !checkResult || checkResult.hasConflicts}
          loading={merging}
          onClick={handleMerge}
        >
          Merge
        </Button>
      </div>
    </Dialog>
  )
}

// ── GitPanel ───────────────────────────────────────────────────────────────

export function GitPanel() {
  const { activeSessionId, sessions } = useSessionStore()
  const { loadCommits, loadWorkingFiles, loadCommitStatuses, clear } = useGitStore()
  const { addToast } = useToastStore.getState()

  const commitCol = useResizable({ direction: 'horizontal', initialSize: 288, minSize: 160, maxSize: 500 })
  const filesCol = useResizable({ direction: 'horizontal', initialSize: 224, minSize: 140, maxSize: 400 })

  const activeSession = sessions.find((s) => s.id === activeSessionId)

  const [pushing, setPushing] = useState(false)
  const [openingPR, setOpeningPR] = useState(false)
  const [mergeOpen, setMergeOpen] = useState(false)

  useEffect(() => {
    if (!activeSession) {
      clear()
      return
    }

    const refresh = () => {
      loadCommits(activeSession.worktreePath)
      loadWorkingFiles(activeSession.worktreePath)
      loadCommitStatuses(activeSession.worktreePath)
    }

    refresh()
    const id = setInterval(refresh, POLL_INTERVAL)
    return () => clearInterval(id)
  }, [activeSession?.id])

  const handlePush = async () => {
    if (!activeSession) return
    setPushing(true)
    try {
      await window.api.git.push(activeSession.worktreePath)
      addToast('success', 'Pushed to remote')
      loadCommitStatuses(activeSession.worktreePath)
    } catch (err: any) {
      addToast('error', err.message)
    } finally {
      setPushing(false)
    }
  }

  const handleOpenPR = async () => {
    if (!activeSession) return
    setOpeningPR(true)
    try {
      await window.api.git.openPR(activeSession.worktreePath)
    } catch (err: any) {
      addToast('error', err.message)
    } finally {
      setOpeningPR(false)
    }
  }

  if (!activeSession) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-xs">
        Select a session to view git history
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Toolbar */}
      <div className="flex items-center gap-1 bg-bg-secondary border-b border-border" style={{ padding: '2px 4px' }}>
        <ToolbarBtn icon={<PushIcon />} label="Push" onClick={handlePush} loading={pushing} />
        <div className="w-px h-4 bg-border mx-0.5" />
        <ToolbarBtn icon={<OpenPRIcon />} label="Open PR" onClick={handleOpenPR} loading={openingPR} />
        <div className="w-px h-4 bg-border mx-0.5" />
        <ToolbarBtn icon={<MergeIcon />} label="Merge In" onClick={() => setMergeOpen(true)} />
      </div>

      {/* Three-column layout */}
      <div className="flex-1 flex min-h-0 min-w-0">
        {/* Commit list */}
        <div style={{ width: commitCol.size }} className="flex-shrink-0 flex flex-col min-h-0">
          <div className="px-3 py-1.5 bg-bg-tertiary border-b border-border text-xs text-text-muted">
            Commits
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
        <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
          <DiffViewer />
        </div>
      </div>

      <MergeDialog
        open={mergeOpen}
        onClose={() => setMergeOpen(false)}
        repoPath={activeSession.worktreePath}
      />
    </div>
  )
}
