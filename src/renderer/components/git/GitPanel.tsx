import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react'
import { useGitStore } from '../../stores/gitStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useToastStore } from '../../stores/toastStore'
import { usePRPreviewStore, getSavedBranchForSession } from '../../stores/prPreviewStore'
import { CommitList } from './CommitList'
import { ChangedFiles } from './ChangedFiles'
import { DiffViewer } from './DiffViewer'
import { PRPreviewPanel } from './PRPreviewPanel'
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

const CompareIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="18" cy="18" r="3" />
    <circle cx="6" cy="6" r="3" />
    <path d="M6 21V9a9 9 0 0 0 9 9" />
  </svg>
)

// ── Branch picker dropdown ────────────────────────────────────────────────

function BranchOption({
  branch,
  label,
  selected,
  onSelect,
}: {
  branch: string | null
  label?: string
  selected: boolean
  onSelect: (branch: string | null) => void
}) {
  return (
    <div
      role="option"
      aria-selected={selected}
      onClick={() => onSelect(branch)}
      className={`text-xs cursor-pointer transition-colors truncate ${
        selected
          ? 'bg-accent/15 text-text'
          : 'text-text-muted hover:bg-bg-tertiary hover:text-text'
      }`}
      style={{ padding: '6px 10px' }}
    >
      {label ?? branch ?? 'None'}
    </div>
  )
}

function BranchPickerDropdown({
  repoPath,
  selectedBranch,
  sessionBaseBranch,
  onSelect,
}: {
  repoPath: string
  selectedBranch: string | null
  sessionBaseBranch?: string
  onSelect: (branch: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [branches, setBranches] = useState<string[]>([])
  const [defaultBranch, setDefaultBranch] = useState<string | null>(null)
  const [loadingBranches, setLoadingBranches] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Load branches + default branch when opened
  useEffect(() => {
    if (!open) return
    setLoadingBranches(true)
    setQuery('')
    Promise.all([
      window.api.git.listBranches(repoPath),
      window.api.git.defaultBranch(repoPath).catch(() => null),
    ])
      .then(([branchList, defBranch]) => {
        setBranches(branchList)
        setDefaultBranch(defBranch ?? null)
      })
      .catch(() => {
        setBranches([])
        setDefaultBranch(null)
      })
      .finally(() => {
        setLoadingBranches(false)
        setTimeout(() => inputRef.current?.focus(), 0)
      })
  }, [open, repoPath])

  // Close on click outside
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  // Compute pinned branches (deduplicated, only if they exist in the branch list)
  const pinnedBranches = useMemo(() => {
    const pinned: { branch: string; label: string }[] = []
    const seen = new Set<string>()
    if (defaultBranch && branches.includes(defaultBranch)) {
      pinned.push({ branch: defaultBranch, label: `${defaultBranch} (default)` })
      seen.add(defaultBranch)
    }
    if (sessionBaseBranch && !seen.has(sessionBaseBranch) && branches.includes(sessionBaseBranch)) {
      pinned.push({ branch: sessionBaseBranch, label: `${sessionBaseBranch} (base)` })
      seen.add(sessionBaseBranch)
    }
    return { items: pinned, names: seen }
  }, [branches, defaultBranch, sessionBaseBranch])

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    return branches.filter(
      (b) => !pinnedBranches.names.has(b) && b.toLowerCase().includes(q)
    )
  }, [branches, query, pinnedBranches.names])

  // Also filter pinned branches by query
  const filteredPinned = useMemo(() => {
    if (!query) return pinnedBranches.items
    const q = query.toLowerCase()
    return pinnedBranches.items.filter((p) => p.branch.toLowerCase().includes(q))
  }, [pinnedBranches.items, query])

  const handleSelect = (branch: string | null) => {
    onSelect(branch)
    setOpen(false)
  }

  return (
    <div ref={containerRef} className="relative flex items-center gap-0.5">
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 text-[11px] transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-accent rounded ${
          selectedBranch ? 'text-accent' : 'text-text-muted hover:text-text'
        }`}
        style={{ padding: '4px 8px' }}
      >
        <CompareIcon />
        {selectedBranch ? `vs ${selectedBranch}` : 'Compare'}
        <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" className={`transition-transform ${open ? 'rotate-180' : ''}`}>
          <path d="M1 2.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>

      {/* Quick dismiss X button when comparing */}
      {selectedBranch && (
        <button
          onClick={() => onSelect(null)}
          className="flex items-center justify-center text-text-muted hover:text-text transition-colors rounded hover:bg-bg-tertiary"
          style={{ width: '18px', height: '18px' }}
          title="Stop comparing"
        >
          <svg width="8" height="8" viewBox="0 0 8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M1 1l6 6M7 1l-6 6" />
          </svg>
        </button>
      )}

      {open && (
        <div
          className="absolute top-full left-0 mt-1 bg-bg-secondary border border-border rounded shadow-lg z-50"
          style={{ width: '240px' }}
        >
          {/* Search input */}
          <div style={{ padding: '6px' }}>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search branches…"
              className="w-full bg-bg border border-border rounded text-xs text-text focus:outline-none focus:border-accent"
              style={{ padding: '5px 8px' }}
            />
          </div>

          {/* Branch list */}
          <div
            className="overflow-y-auto border-t border-border"
            style={{ maxHeight: '200px' }}
            role="listbox"
            aria-label="Compare branch"
          >
            {/* None option */}
            <BranchOption branch={null} label="None" selected={selectedBranch === null} onSelect={handleSelect} />

            {/* Pinned branches */}
            {filteredPinned.map((p) => (
              <BranchOption
                key={p.branch}
                branch={p.branch}
                label={p.label}
                selected={selectedBranch === p.branch}
                onSelect={handleSelect}
              />
            ))}

            {/* Divider between pinned and rest */}
            {filteredPinned.length > 0 && filtered.length > 0 && (
              <div className="border-t border-border my-0.5" />
            )}

            {loadingBranches ? (
              <div className="text-text-muted text-xs text-center" style={{ padding: '10px' }}>Loading…</div>
            ) : filtered.length === 0 && filteredPinned.length === 0 ? (
              <div className="text-text-muted text-xs text-center" style={{ padding: '10px' }}>No branches found</div>
            ) : (
              filtered.map((b) => (
                <BranchOption
                  key={b}
                  branch={b}
                  selected={selectedBranch === b}
                  onSelect={handleSelect}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

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
  const previewActive = usePRPreviewStore((s) => s.active)

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

    // Don't poll when PR preview is active
    if (previewActive) return

    const refresh = () => {
      loadCommits(activeSession.worktreePath)
      loadWorkingFiles(activeSession.worktreePath)
      loadCommitStatuses(activeSession.worktreePath)
    }

    refresh()
    const id = setInterval(refresh, POLL_INTERVAL)
    return () => clearInterval(id)
  }, [activeSession?.id, previewActive])

  // Save/restore PR preview when session changes
  useEffect(() => {
    if (!activeSession) {
      usePRPreviewStore.getState().deactivate()
      return
    }
    // Check if the new session has a saved PR preview branch
    const savedBranch = getSavedBranchForSession(activeSession.id)
    if (savedBranch) {
      usePRPreviewStore.getState().activate(activeSession.worktreePath, savedBranch, activeSession.id)
    } else {
      usePRPreviewStore.getState().deactivate()
    }
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

  const previewBaseBranch = usePRPreviewStore((s) => s.baseBranch)

  const handleCompareSelect = useCallback((branch: string | null) => {
    if (!activeSession) return
    if (branch === null) {
      usePRPreviewStore.getState().deactivate(activeSession.id)
    } else {
      usePRPreviewStore.getState().activate(activeSession.worktreePath, branch, activeSession.id)
    }
  }, [activeSession?.id, activeSession?.worktreePath])

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
        <div className="w-px h-4 bg-border mx-0.5" />
        <BranchPickerDropdown
          repoPath={activeSession.worktreePath}
          selectedBranch={previewBaseBranch}
          sessionBaseBranch={activeSession.baseBranch}
          onSelect={handleCompareSelect}
        />
      </div>

      {previewActive ? (
        <PRPreviewPanel repoPath={activeSession.worktreePath} />
      ) : (
        <>
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
              <DiffViewer repoPath={activeSession.worktreePath} />
            </div>
          </div>
        </>
      )}

      <MergeDialog
        open={mergeOpen}
        onClose={() => setMergeOpen(false)}
        repoPath={activeSession.worktreePath}
      />
    </div>
  )
}
