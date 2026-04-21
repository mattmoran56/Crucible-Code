import React, { useRef, useEffect, useState, useCallback } from 'react'
import { PRDiffViewer } from '../git/DiffViewer'
import { ImageDiffViewer, isImageFile } from '../git/ImageDiffViewer'
import type { PRFile, PRComment } from '../../../shared/types'
import { DiffErrorBoundary } from '../ui/DiffErrorBoundary'
import { extractFileDiff } from '../../lib/extractFileDiff'

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

interface PRScrollableDiffViewProps {
  files: PRFile[]
  fullDiff: string
  comments: PRComment[]
  viewedFiles: Set<string>
  onToggleViewed: (path: string) => void
  onAddComment: (path: string, startLine: number, endLine: number, side: 'LEFT' | 'RIGHT', body: string) => Promise<void>
  repoPath?: string
  beforeRef?: string
  selectedCommitHash?: string | null
}

export function PRScrollableDiffView({
  files, fullDiff, comments, viewedFiles, onToggleViewed, onAddComment,
  repoPath, beforeRef, selectedCommitHash,
}: PRScrollableDiffViewProps) {
  return (
    <div className="flex-1 overflow-y-auto">
      {files.map((file) => (
        <LazyFileSection
          key={file.path}
          file={file}
          fullDiff={fullDiff}
          comments={comments.filter((c) => c.path === file.path)}
          isViewed={viewedFiles.has(file.path)}
          onToggleViewed={() => onToggleViewed(file.path)}
          onAddComment={(startLine, endLine, side, body) =>
            onAddComment(file.path, startLine, endLine, side, body)
          }
          repoPath={repoPath}
          beforeRef={beforeRef}
          selectedCommitHash={selectedCommitHash}
        />
      ))}
    </div>
  )
}

interface LazyFileSectionProps {
  file: PRFile
  fullDiff: string
  comments: PRComment[]
  isViewed: boolean
  onToggleViewed: () => void
  onAddComment: (startLine: number, endLine: number, side: 'LEFT' | 'RIGHT', body: string) => Promise<void>
  repoPath?: string
  beforeRef?: string
  selectedCommitHash?: string | null
}

function LazyFileSection({
  file, fullDiff, comments, isViewed, onToggleViewed, onAddComment,
  repoPath, beforeRef, selectedCommitHash,
}: LazyFileSectionProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [collapsed, setCollapsed] = useState(isViewed)

  // Auto-collapse when marked as viewed
  const prevViewed = useRef(isViewed)
  useEffect(() => {
    if (isViewed && !prevViewed.current) {
      setCollapsed(true)
    }
    prevViewed.current = isViewed
  }, [isViewed])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '200px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const fileDiff = visible ? extractFileDiff(fullDiff, file.path) : ''

  const handleToggleViewed = useCallback(() => {
    onToggleViewed()
  }, [onToggleViewed])

  return (
    <div ref={ref} data-file-path={file.path}>
      {/* Sticky file header */}
      <div
        className="sticky top-0 z-10 flex items-center gap-2 bg-bg-tertiary border-b border-border text-xs"
        style={{ padding: '6px 12px' }}
      >
        {/* Collapse toggle on the left */}
        <button
          className="flex-shrink-0 text-text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? 'Expand file diff' : 'Collapse file diff'}
          aria-expanded={!collapsed}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 10 10"
            fill="currentColor"
            className={`transition-transform ${collapsed ? '' : 'rotate-90'}`}
          >
            <path d="M3 1l5 4-5 4V1z" />
          </svg>
        </button>
        <span className={`font-mono font-bold ${STATUS_COLORS[file.status] || 'text-warning'}`}>
          {STATUS_LABELS[file.status] || 'M'}
        </span>
        <span className={`truncate min-w-0 ${isViewed ? 'text-text-muted' : 'text-text'}`}>{file.path}</span>
        <span className="flex items-center gap-2 text-[10px] text-text-muted flex-shrink-0">
          {file.additions > 0 && <span className="text-success">+{file.additions}</span>}
          {file.deletions > 0 && <span className="text-danger">-{file.deletions}</span>}
        </span>
        {/* Spacer to push checkbox to the right */}
        <div className="flex-1" />
        {/* Viewed checkbox pinned right */}
        <label className="flex items-center gap-1 cursor-pointer select-none flex-shrink-0 text-[10px]">
          <input
            type="checkbox"
            checked={isViewed}
            onChange={handleToggleViewed}
            className="accent-accent cursor-pointer"
            style={{ width: 13, height: 13 }}
          />
          <span className={isViewed ? 'text-accent' : 'text-text-muted'}>Viewed</span>
        </label>
      </div>
      {/* Diff content — hidden when collapsed */}
      {!collapsed && (
        visible ? (
          repoPath && isImageFile(file.path) ? (
            <ImageDiffViewer
              repoPath={repoPath}
              filePath={file.path}
              status={(file.status as 'added' | 'modified' | 'deleted' | 'renamed') || 'modified'}
              beforeRef={selectedCommitHash && selectedCommitHash !== 'WORKING_CHANGES'
                ? `${selectedCommitHash}~1`
                : beforeRef || 'HEAD'}
              afterRef={selectedCommitHash === 'WORKING_CHANGES'
                ? null
                : selectedCommitHash || undefined}
            />
          ) : fileDiff ? (
            <DiffErrorBoundary filePath={file.path}>
              <PRDiffViewer
                patch={fileDiff}
                filePath={file.path}
                comments={comments}
                onAddComment={onAddComment}
              />
            </DiffErrorBoundary>
          ) : (
            <div
              className="flex items-center justify-center text-text-muted text-xs"
              style={{ height: 100 }}
            >
              Loading...
            </div>
          )
        ) : (
          <div
            className="flex items-center justify-center text-text-muted text-xs"
            style={{ height: 100 }}
          >
            Loading...
          </div>
        )
      )}
    </div>
  )
}
