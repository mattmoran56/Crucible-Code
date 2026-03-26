import React, { useEffect, useMemo, useState } from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import { useProjectStore } from '../../stores/projectStore'
import { usePRReviewStore } from '../../stores/prReviewStore'
import { usePRStore } from '../../stores/prStore'
import { PRDiffViewer } from '../git/DiffViewer'
import { PRConversationTab } from './PRConversationTab'
import { PRScrollableDiffView } from './PRScrollableDiffView'
import { FileTree } from './FileTree'
import { ResizeHandle } from '../ui/ResizeHandle'
import { useResizable } from '../../hooks/useResizable'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { ToggleGroup } from '../ui/ToggleGroup'
import type { PRReviewEvent, PRFile } from '../../../shared/types'

/** Extract the diff for a single file from the full PR diff */
function extractFileDiff(fullDiff: string, filePath: string): string {
  const lines = fullDiff.split('\n')
  let capture = false
  const result: string[] = []

  for (const line of lines) {
    if (line.startsWith('diff --git')) {
      if (capture) break
      // Check if this diff block is for our file
      if (line.includes(`b/${filePath}`)) {
        capture = true
      }
    }
    if (capture) {
      result.push(line)
    }
  }

  return result.join('\n')
}

export function PRReviewPanel() {
  const { activePRNumber, didStash, checkStaleness, clearActiveContext } = useSessionStore()
  const { loadPRs } = usePRStore()
  const { projects, activeProjectId } = useProjectStore()
  const {
    files, selectedFilePath, fullDiff, fileDiffCache, fileDiffLoading, comments, loading, mergeable,
    reviewLoading, mergeLoading, activeTab, viewedFiles,
    commits, selectedCommitHash, commitDiff, viewMode,
    reviewThreads, commentFilter,
    loadPR, selectFile, selectNextFile, selectPrevFile, setViewMode, toggleFileViewed,
    selectCommit, nextCommit, prevCommit, setCommentFilter,
    loadFileDiff, addComment, submitReview, merge, setActiveTab, clear,
  } = usePRReviewStore()

  const [showReviewDialog, setShowReviewDialog] = useState(false)
  const [reviewEvent, setReviewEvent] = useState<PRReviewEvent>('APPROVE')
  const [reviewBody, setReviewBody] = useState('')
  const [showMergeConfirm, setShowMergeConfirm] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  const activeProject = projects.find((p) => p.id === activeProjectId)
  const prNumber = activePRNumber

  const filesCol = useResizable({ direction: 'horizontal', initialSize: 240, minSize: 160, maxSize: 400 })

  // Load PR data when active PR changes
  useEffect(() => {
    if (prNumber && activeProject) {
      loadPR(activeProject.repoPath, prNumber, activeProject.id)
    }
  }, [prNumber, activeProject?.id])

  // Keyboard shortcuts: [ / ] for file nav, < / > for commit nav
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === '[') {
        e.preventDefault()
        selectPrevFile()
      } else if (e.key === ']') {
        e.preventDefault()
        selectNextFile()
      } else if (e.key === '<' || (e.key === ',' && e.shiftKey)) {
        e.preventDefault()
        prevCommit(activeProject?.repoPath || '')
      } else if (e.key === '>' || (e.key === '.' && e.shiftKey)) {
        e.preventDefault()
        nextCommit(activeProject?.repoPath || '')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [activeProject?.repoPath, selectPrevFile, selectNextFile, prevCommit, nextCommit])

  // Use commit-specific diff when a commit is selected, otherwise full PR diff
  const activeDiff = selectedCommitHash ? commitDiff : fullDiff

  // Parse files from commit diff when a commit is selected
  const displayFiles = useMemo(() => {
    if (!selectedCommitHash || !commitDiff) return files
    const fileSet = new Set<string>()
    for (const line of commitDiff.split('\n')) {
      if (line.startsWith('diff --git')) {
        const match = line.match(/b\/(.+)$/)
        if (match) fileSet.add(match[1])
      }
    }
    return files.filter((f) => fileSet.has(f.path))
  }, [selectedCommitHash, commitDiff, files])

  // Compute files with unresolved comments
  const unresolvedFiles = useMemo(() => {
    const set = new Set<string>()
    for (const t of reviewThreads) {
      if (!t.isResolved) set.add(t.path)
    }
    return set
  }, [reviewThreads])

  // Apply comment filter to display files
  const filteredDisplayFiles = useMemo(() => {
    if (commentFilter === 'all') return displayFiles
    return displayFiles.filter((f) => unresolvedFiles.has(f.path))
  }, [displayFiles, commentFilter, unresolvedFiles])

  // For large PRs where fullDiff is null, load file diffs on demand
  useEffect(() => {
    if (selectedFilePath && fullDiff === null && !loading && prNumber && activeProject) {
      loadFileDiff(activeProject.repoPath, prNumber, selectedFilePath)
    }
  }, [selectedFilePath, fullDiff, loading, prNumber, activeProject?.id])

  if (!prNumber || !activeProject) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-xs">
        Select a PR from the sidebar to review
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-xs">
        Loading PR #{prNumber}...
      </div>
    )
  }

  // Use commit diff when selected, full PR diff when available, otherwise per-file cache
  const fileDiff = selectedFilePath
    ? activeDiff
      ? extractFileDiff(activeDiff, selectedFilePath)
      : fileDiffCache[selectedFilePath] || ''
    : ''
  const isFileDiffLoading = fileDiffLoading === selectedFilePath

  const fileComments = selectedFilePath
    ? comments.filter((c) => c.path === selectedFilePath)
    : []

  const commitIndex = selectedCommitHash
    ? commits.findIndex((c) => c.hash === selectedCommitHash)
    : -1

  const handleAddComment = async (startLine: number, endLine: number, side: 'LEFT' | 'RIGHT', body: string) => {
    if (!selectedFilePath) return
    await addComment(activeProject.repoPath, prNumber, body, selectedFilePath, startLine, endLine, side)
  }

  const handleSubmitReview = async () => {
    await submitReview(activeProject.repoPath, prNumber, reviewEvent, reviewBody || undefined)
    setShowReviewDialog(false)
    setReviewBody('')
  }

  const handleMerge = async () => {
    await merge(activeProject.repoPath, prNumber, 'merge')
    setShowMergeConfirm(false)
    await clearActiveContext()
    loadPRs(activeProject.repoPath)
    checkStaleness(activeProject.repoPath)
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* PR toolbar */}
      <div
        className="flex items-center justify-between bg-bg-tertiary border-b border-border"
        style={{ padding: '6px 12px' }}
      >
        <span className="text-xs text-text-muted">
          PR #{prNumber} &middot; {files.length} file{files.length !== 1 ? 's' : ''} &middot;{' '}
          <span className="text-success">
            +{files.reduce((s, f) => s + f.additions, 0)}
          </span>{' '}
          <span className="text-danger">
            -{files.reduce((s, f) => s + f.deletions, 0)}
          </span>
        </span>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setReviewEvent('REQUEST_CHANGES')
              setShowReviewDialog(true)
            }}
            disabled={reviewLoading}
          >
            Request Changes
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setReviewEvent('APPROVE')
              setShowReviewDialog(true)
            }}
            disabled={reviewLoading}
          >
            Approve
          </Button>
          {mergeable === 'CONFLICTING' ? (
            <span
              className="text-danger text-xs font-medium flex items-center gap-1"
              style={{ padding: '4px 2px' }}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 12a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm.75-4.5h-1.5L7 4.5h2l-.25 4z"/>
              </svg>
              Merge conflicts
            </span>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setShowMergeConfirm(true)}
              disabled={mergeLoading || mergeable === 'UNKNOWN'}
              title={mergeable === 'UNKNOWN' ? 'Mergeability unknown' : undefined}
            >
              {mergeLoading ? 'Merging...' : 'Merge'}
            </Button>
          )}
        </div>
      </div>

      {/* Stash notice */}
      {didStash && (
        <div
          className="flex items-center gap-2 bg-warning/10 border-b border-warning/30 text-warning text-xs"
          style={{ padding: '4px 12px' }}
        >
          <span>Uncommitted changes were stashed. Run <code className="font-mono bg-bg/50 px-1 rounded">git stash pop</code> to restore them.</span>
        </div>
      )}

      {/* Inner tab bar */}
      <div className="flex items-center bg-bg-secondary border-b border-border" style={{ padding: '0 8px' }}>
        <InnerTab
          active={activeTab === 'conversation'}
          onClick={() => setActiveTab('conversation')}
          label="Conversation"
        />
        <InnerTab
          active={activeTab === 'files'}
          onClick={() => setActiveTab('files')}
          label={`Files (${files.length})`}
        />
      </div>

      {/* Tab content */}
      {activeTab === 'conversation' ? (
        <PRConversationTab />
      ) : (
        <div className="flex-1 flex flex-col min-h-0">
          {/* Stats bar + view mode toggle */}
          <div className="flex items-center gap-4 bg-bg-secondary border-b border-border" style={{ padding: '4px 12px' }}>
            <DiffStatsBar files={displayFiles} viewedCount={viewedFiles.size} />
            <ToggleGroup
              options={[
                { value: 'single' as const, label: 'File' },
                { value: 'scroll' as const, label: 'Scroll' },
              ]}
              value={viewMode}
              onChange={setViewMode}
              className="ml-auto"
            />
          </div>
          {/* Commit selector */}
          {commits.length > 0 && (
            <div
              className="flex items-center gap-2 bg-bg-secondary border-b border-border text-xs"
              style={{ padding: '4px 12px' }}
            >
              <select
                className="bg-bg text-text text-xs border border-border rounded focus:outline-none focus:border-accent cursor-pointer"
                style={{ padding: '2px 6px', maxWidth: 300 }}
                value={selectedCommitHash || ''}
                onChange={(e) => selectCommit(activeProject.repoPath, e.target.value || null)}
              >
                <option value="">All changes</option>
                {commits.map((c, i) => (
                  <option key={c.hash} value={c.hash}>
                    {i + 1}. {c.hash.slice(0, 7)} — {c.message.length > 50 ? c.message.slice(0, 50) + '…' : c.message}
                  </option>
                ))}
              </select>
              {selectedCommitHash && (
                <div className="flex items-center gap-1 text-text-muted">
                  <button
                    className="hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
                    style={{ padding: '2px 4px' }}
                    onClick={() => prevCommit(activeProject.repoPath)}
                    disabled={commitIndex === 0}
                    aria-label="Previous commit"
                  >
                    ←
                  </button>
                  <span>Commit {commitIndex + 1} of {commits.length}</span>
                  <button
                    className="hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
                    style={{ padding: '2px 4px' }}
                    onClick={() => nextCommit(activeProject.repoPath)}
                    disabled={commitIndex === commits.length - 1}
                    aria-label="Next commit"
                  >
                    →
                  </button>
                </div>
              )}
            </div>
          )}
          <div className="flex-1 flex min-h-0">
            {/* File list sidebar — shown in both modes, collapsible */}
            {!sidebarCollapsed && (
              <>
                <div style={{ width: filesCol.size }} className="flex-shrink-0 flex flex-col min-h-0 border-r border-border">
                  <div className="flex items-center justify-between bg-bg-tertiary border-b border-border text-xs text-text-muted" style={{ padding: '6px 12px' }}>
                    <div className="flex items-center gap-2">
                      <span>Files</span>
                      {unresolvedFiles.size > 0 && (
                        <button
                          className={`flex items-center gap-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                            commentFilter === 'unresolved' ? 'text-danger' : 'text-text-muted hover:text-text'
                          }`}
                          style={{ padding: '1px 4px', fontSize: '10px' }}
                          onClick={() => setCommentFilter(commentFilter === 'all' ? 'unresolved' : 'all')}
                          title={commentFilter === 'all' ? 'Show only files with unresolved comments' : 'Show all files'}
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-danger" />
                          {unresolvedFiles.size}
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span>{viewedFiles.size}/{filteredDisplayFiles.length} viewed</span>
                      <button
                        className="text-text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
                        onClick={() => setSidebarCollapsed(true)}
                        aria-label="Collapse file list"
                        title="Collapse file list"
                      >
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                          <path d="M9.5 3L4.5 8l5 5V3z"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                  <FileTree
                    files={filteredDisplayFiles}
                    selectedFilePath={selectedFilePath}
                    viewedFiles={viewedFiles}
                    unresolvedFiles={unresolvedFiles}
                    onSelectFile={selectFile}
                    onToggleViewed={(path) => {
                      if (activeProject && prNumber) {
                        toggleFileViewed(activeProject.id, prNumber, path)
                      }
                    }}
                  />
                </div>
                <ResizeHandle direction="horizontal" onMouseDown={filesCol.onMouseDown} />
              </>
            )}
            {sidebarCollapsed && (
              <div className="flex-shrink-0 flex flex-col items-center border-r border-border bg-bg-secondary" style={{ padding: '6px 4px' }}>
                <button
                  className="text-text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
                  onClick={() => setSidebarCollapsed(false)}
                  aria-label="Expand file list"
                  title="Expand file list"
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M6.5 3L11.5 8l-5 5V3z"/>
                  </svg>
                </button>
              </div>
            )}

            {/* Main content area */}
            <div className="flex-1 flex flex-col min-h-0">
              {viewMode === 'scroll' ? (
                <PRScrollableDiffView
                  files={filteredDisplayFiles}
                  fullDiff={activeDiff || ''}
                  comments={comments}
                  viewedFiles={viewedFiles}
                  onToggleViewed={(path) => {
                    if (activeProject && prNumber) {
                      toggleFileViewed(activeProject.id, prNumber, path)
                    }
                  }}
                  onAddComment={async (path, startLine, endLine, side, body) => {
                    await addComment(activeProject.repoPath, prNumber, body, path, startLine, endLine, side)
                  }}
                />
              ) : (
                <>
                  {selectedFilePath && (
                    <div
                      className="flex items-center gap-2 bg-bg-tertiary border-b border-border text-xs"
                      style={{ padding: '4px 12px' }}
                    >
                      <button
                        className="text-text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
                        style={{ padding: '2px 4px' }}
                        onClick={selectPrevFile}
                        aria-label="Previous file"
                      >
                        ←
                      </button>
                      <span className="text-text-muted">
                        {filteredDisplayFiles.findIndex((f) => f.path === selectedFilePath) + 1} of {filteredDisplayFiles.length}
                      </span>
                      <button
                        className="text-text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
                        style={{ padding: '2px 4px' }}
                        onClick={selectNextFile}
                        aria-label="Next file"
                      >
                        →
                      </button>
                      <span className="text-text truncate ml-1">{selectedFilePath}</span>
                    </div>
                  )}
                  {isFileDiffLoading ? (
                    <div className="flex-1 flex items-center justify-center text-text-muted text-xs">
                      Loading diff...
                    </div>
                  ) : selectedFilePath && fileDiff ? (
                    <PRDiffViewer
                      patch={fileDiff}
                      filePath={selectedFilePath}
                      comments={fileComments}
                      onAddComment={handleAddComment}
                    />
                  ) : (
                    <div className="flex-1 flex items-center justify-center text-text-muted text-xs">
                      Select a file to review
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Review dialog */}
      <Dialog
        open={showReviewDialog}
        onClose={() => setShowReviewDialog(false)}
        title={reviewEvent === 'APPROVE' ? 'Approve PR' : 'Request Changes'}
      >
        <textarea
          value={reviewBody}
          onChange={(e) => setReviewBody(e.target.value)}
          placeholder={reviewEvent === 'APPROVE' ? 'Optional comment...' : 'Describe the changes needed...'}
          className="w-full bg-bg text-text text-xs border border-border rounded resize-none focus:outline-none focus:border-accent mb-4"
          style={{ padding: '10px 12px' }}
          rows={4}
          autoFocus
        />
        <div className="flex gap-3 justify-end">
          <Button variant="ghost" size="sm" onClick={() => setShowReviewDialog(false)}>
            Cancel
          </Button>
          <Button
            variant={reviewEvent === 'APPROVE' ? 'primary' : 'danger'}
            size="sm"
            onClick={handleSubmitReview}
            disabled={reviewLoading}
          >
            {reviewLoading ? 'Submitting...' : reviewEvent === 'APPROVE' ? 'Approve' : 'Request Changes'}
          </Button>
        </div>
      </Dialog>

      {/* Merge confirmation */}
      <Dialog
        open={showMergeConfirm}
        onClose={() => setShowMergeConfirm(false)}
        title="Merge Pull Request"
      >
        <p className="text-xs text-text-muted mb-5">
          This will create a merge commit for PR #{prNumber} and delete the source branch.
        </p>
        <div className="flex gap-3 justify-end">
          <Button variant="ghost" size="sm" onClick={() => setShowMergeConfirm(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleMerge}
            disabled={mergeLoading}
          >
            {mergeLoading ? 'Merging...' : 'Confirm Merge'}
          </Button>
        </div>
      </Dialog>
    </div>
  )
}

function DiffStatsBar({ files, viewedCount }: { files: PRFile[]; viewedCount: number }) {
  const totalAdded = files.reduce((s, f) => s + f.additions, 0)
  const totalDeleted = files.reduce((s, f) => s + f.deletions, 0)
  const total = totalAdded + totalDeleted
  const addedPct = total > 0 ? (totalAdded / total) * 100 : 50

  const addedFiles = files.filter((f) => f.status === 'added').length
  const modifiedFiles = files.filter((f) => f.status === 'modified').length
  const deletedFiles = files.filter((f) => f.status === 'deleted').length

  return (
    <div className="flex items-center gap-3 text-[10px] text-text-muted">
      <div className="flex items-center gap-1.5">
        {addedFiles > 0 && <span className="text-success">{addedFiles} added</span>}
        {modifiedFiles > 0 && <span className="text-warning">{modifiedFiles} modified</span>}
        {deletedFiles > 0 && <span className="text-danger">{deletedFiles} deleted</span>}
      </div>
      <div className="h-[6px] rounded-full overflow-hidden bg-bg-tertiary" style={{ width: 120 }}>
        <div className="h-full bg-success" style={{ width: `${addedPct}%` }} />
      </div>
      <span className="text-success">+{totalAdded}</span>
      <span className="text-danger">-{totalDeleted}</span>
      <span>{viewedCount}/{files.length} reviewed</span>
    </div>
  )
}

function InnerTab({
  active,
  onClick,
  label,
}: {
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      onClick={onClick}
      role="tab"
      aria-selected={active}
      className={`text-xs transition-colors relative focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset ${
        active ? 'text-text' : 'text-text-muted hover:text-text'
      }`}
      style={{ padding: '6px 10px' }}
    >
      {label}
      {active && (
        <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent" />
      )}
    </button>
  )
}
