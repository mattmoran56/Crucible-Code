import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { usePRPreviewStore } from '../../stores/prPreviewStore'
import { PRDiffViewer } from './DiffViewer'
import { FileTree } from '../pullrequests/FileTree'
import { PRScrollableDiffView } from '../pullrequests/PRScrollableDiffView'
import { ResizeHandle } from '../ui/ResizeHandle'
import { ToggleGroup } from '../ui/ToggleGroup'
import { useResizable } from '../../hooks/useResizable'
import type { PRFile } from '../../../shared/types'

/** Extract the diff for a single file from a full unified diff */
function extractFileDiff(fullDiff: string, filePath: string): string {
  const lines = fullDiff.split('\n')
  let capture = false
  const result: string[] = []

  for (const line of lines) {
    if (line.startsWith('diff --git')) {
      if (capture) break
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

interface Props {
  repoPath: string
}

export function PRPreviewPanel({ repoPath }: Props) {
  const {
    baseBranch, files, fullDiff, commits,
    selectedFilePath, selectedCommitHash, commitDiff,
    viewMode, loading,
    selectFile, selectNextFile, selectPrevFile,
    selectCommit, nextCommit, prevCommit, setViewMode,
  } = usePRPreviewStore()

  const filesCol = useResizable({ direction: 'horizontal', initialSize: 240, minSize: 160, maxSize: 400 })
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

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
        prevCommit(repoPath)
      } else if (e.key === '>' || (e.key === '.' && e.shiftKey)) {
        e.preventDefault()
        nextCommit(repoPath)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [repoPath, selectPrevFile, selectNextFile, prevCommit, nextCommit])

  // Use commit-specific diff when a commit is selected, otherwise full diff
  const activeDiff = selectedCommitHash ? commitDiff : fullDiff

  // Filter files when viewing a specific commit
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

  // No-ops for FileTree props we don't need — must be before any early returns
  const emptySet = useMemo(() => new Set<string>(), [])
  const noop = useCallback(() => {}, [])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-xs">
        Loading PR preview...
      </div>
    )
  }

  const fileDiff = selectedFilePath && activeDiff
    ? extractFileDiff(activeDiff, selectedFilePath)
    : ''

  const commitIndex = selectedCommitHash
    ? commits.findIndex((c) => c.hash === selectedCommitHash)
    : -1

  const totalAdded = files.reduce((s, f) => s + f.additions, 0)
  const totalDeleted = files.reduce((s, f) => s + f.deletions, 0)

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Summary bar */}
      <div
        className="flex items-center justify-between bg-bg-tertiary border-b border-border"
        style={{ padding: '4px 12px' }}
      >
        <span className="text-xs text-text-muted">
          {commits.length} commit{commits.length !== 1 ? 's' : ''} &middot;{' '}
          {files.length} file{files.length !== 1 ? 's' : ''} &middot;{' '}
          <span className="text-success">+{totalAdded}</span>{' '}
          <span className="text-danger">-{totalDeleted}</span>
        </span>
        <ToggleGroup
          options={[
            { value: 'single' as const, label: 'File' },
            { value: 'scroll' as const, label: 'Scroll' },
          ]}
          value={viewMode}
          onChange={setViewMode}
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
            onChange={(e) => selectCommit(repoPath, e.target.value || null)}
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
                onClick={() => prevCommit(repoPath)}
                disabled={commitIndex === 0}
                aria-label="Previous commit"
              >
                ←
              </button>
              <span>Commit {commitIndex + 1} of {commits.length}</span>
              <button
                className="hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
                style={{ padding: '2px 4px' }}
                onClick={() => nextCommit(repoPath)}
                disabled={commitIndex === commits.length - 1}
                aria-label="Next commit"
              >
                →
              </button>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {files.length === 0 && !loading && (
        <div className="flex-1 flex items-center justify-center text-text-muted text-xs">
          No changes between this branch and {baseBranch}
        </div>
      )}

      {/* Main content area */}
      {files.length > 0 && (
        <div className="flex-1 flex min-h-0">
          {/* File tree sidebar */}
          {!sidebarCollapsed && (
            <>
              <div style={{ width: filesCol.size }} className="flex-shrink-0 flex flex-col min-h-0 border-r border-border">
                <div
                  className="flex items-center justify-between bg-bg-tertiary border-b border-border text-xs text-text-muted"
                  style={{ padding: '6px 12px' }}
                >
                  <span>Files ({displayFiles.length})</span>
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
                <FileTree
                  files={displayFiles}
                  selectedFilePath={selectedFilePath}
                  viewedFiles={emptySet}
                  onSelectFile={selectFile}
                  onToggleViewed={noop}
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

          {/* Diff viewer */}
          <div className="flex-1 flex flex-col min-h-0">
            {viewMode === 'scroll' ? (
              <PRScrollableDiffView
                files={displayFiles}
                fullDiff={activeDiff || ''}
                comments={[]}
                viewedFiles={emptySet}
                onToggleViewed={noop}
                onAddComment={async () => {}}
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
                      {displayFiles.findIndex((f) => f.path === selectedFilePath) + 1} of {displayFiles.length}
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
                {selectedFilePath && fileDiff ? (
                  <PRDiffViewer
                    patch={fileDiff}
                    filePath={selectedFilePath}
                    comments={[]}
                    onAddComment={() => {}}
                  />
                ) : (
                  <div className="flex-1 flex items-center justify-center text-text-muted text-xs">
                    Select a file to view diff
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
