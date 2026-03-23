import React, { useEffect, useState } from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import { useProjectStore } from '../../stores/projectStore'
import { usePRReviewStore } from '../../stores/prReviewStore'
import { PRDiffViewer } from '../git/DiffViewer'
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
  const { activePRNumber } = useSessionStore()
  const { projects, activeProjectId } = useProjectStore()
  const {
    files, selectedFilePath, fullDiff, comments, loading,
    reviewLoading, mergeLoading,
    loadPR, selectFile, addComment, submitReview, merge, clear,
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

  const fileDiff = selectedFilePath && fullDiff
    ? extractFileDiff(fullDiff, selectedFilePath)
    : ''

  const fileComments = selectedFilePath
    ? comments.filter((c) => c.path === selectedFilePath)
    : []

  const handleAddComment = async (line: number, body: string) => {
    if (!selectedFilePath) return
    await addComment(activeProject.repoPath, prNumber, body, selectedFilePath, line)
  }

  const handleSubmitReview = async () => {
    await submitReview(activeProject.repoPath, prNumber, reviewEvent, reviewBody || undefined)
    setShowReviewDialog(false)
    setReviewBody('')
  }

  const handleMerge = async () => {
    await merge(activeProject.repoPath, prNumber, 'squash')
    setShowMergeConfirm(false)
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
          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowMergeConfirm(true)}
            disabled={mergeLoading}
          >
            {mergeLoading ? 'Merging...' : 'Merge'}
          </Button>
        </div>
      </div>

      {/* File list + Diff viewer */}
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
          {selectedFilePath && fileDiff ? (
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
          className="w-full bg-bg text-text text-xs border border-border rounded px-3 py-2 resize-none focus:outline-none focus:border-accent mb-4"
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
          This will squash and merge PR #{prNumber} and delete the source branch.
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
