import React, { useEffect, useState } from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import { useProjectStore } from '../../stores/projectStore'
import { usePRReviewStore } from '../../stores/prReviewStore'
import { usePRStore } from '../../stores/prStore'
import { PRDiffViewer } from '../git/DiffViewer'
import { PRConversationTab } from './PRConversationTab'
import { ListBox, ListItem } from '../ui/ListBox'
import { ResizeHandle } from '../ui/ResizeHandle'
import { useResizable } from '../../hooks/useResizable'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import type { PRReviewEvent } from '../../../shared/types'

const STATUS_COLORS: Record<string, string> = {
  added: 'text-success',
  modified: 'text-warning',
  deleted: 'text-danger',
}

const STATUS_LABELS: Record<string, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
}

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
    reviewLoading, mergeLoading, activeTab,
    loadPR, selectFile, loadFileDiff, addComment, submitReview, merge, setActiveTab, clear,
  } = usePRReviewStore()

  const [showReviewDialog, setShowReviewDialog] = useState(false)
  const [reviewEvent, setReviewEvent] = useState<PRReviewEvent>('APPROVE')
  const [reviewBody, setReviewBody] = useState('')
  const [showMergeConfirm, setShowMergeConfirm] = useState(false)

  const activeProject = projects.find((p) => p.id === activeProjectId)
  const prNumber = activePRNumber

  const filesCol = useResizable({ direction: 'horizontal', initialSize: 240, minSize: 160, maxSize: 400 })

  // Load PR data when active PR changes
  useEffect(() => {
    if (prNumber && activeProject) {
      loadPR(activeProject.repoPath, prNumber)
    } else {
      clear()
    }
  }, [prNumber, activeProject?.id])

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

  // Use full diff when available, otherwise use per-file cache
  const fileDiff = selectedFilePath
    ? fullDiff
      ? extractFileDiff(fullDiff, selectedFilePath)
      : fileDiffCache[selectedFilePath] || ''
    : ''
  const isFileDiffLoading = fileDiffLoading === selectedFilePath

  const fileComments = selectedFilePath
    ? comments.filter((c) => c.path === selectedFilePath)
    : []

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
        <div className="flex-1 flex min-h-0">
          {/* File list */}
          <div style={{ width: filesCol.size }} className="flex-shrink-0 flex flex-col min-h-0 border-r border-border">
            <div className="px-3 py-1.5 bg-bg-tertiary border-b border-border text-xs text-text-muted">
              Files
            </div>
            <ListBox
              label="PR files"
              className="flex-1 overflow-y-auto"
              onSelect={(index) => selectFile(files[index].path)}
            >
              {files.map((file) => (
                <ListItem
                  key={file.path}
                  selected={file.path === selectedFilePath}
                  onClick={() => selectFile(file.path)}
                  className="text-xs flex items-center gap-2"
                  style={{ padding: '6px 12px' }}
                >
                  <span className={`font-mono font-bold ${STATUS_COLORS[file.status] || 'text-warning'}`}>
                    {STATUS_LABELS[file.status] || 'M'}
                  </span>
                  <span className="truncate">{file.path}</span>
                  <span className="ml-auto flex gap-1 text-[10px]">
                    {file.additions > 0 && <span className="text-success">+{file.additions}</span>}
                    {file.deletions > 0 && <span className="text-danger">-{file.deletions}</span>}
                  </span>
                </ListItem>
              ))}
            </ListBox>
          </div>
          <ResizeHandle direction="horizontal" onMouseDown={filesCol.onMouseDown} />

          {/* Diff viewer */}
          <div className="flex-1 flex flex-col min-h-0">
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
