import React, { useEffect, useMemo } from 'react'
import { usePRReviewStore } from '../../stores/prReviewStore'
import { useProjectStore } from '../../stores/projectStore'
import { useSessionStore } from '../../stores/sessionStore'
import { usePRStore } from '../../stores/prStore'
import { PRDiffViewer } from '../git/DiffViewer'
import { FileTree } from './FileTree'
import { ListBox, ListItem } from '../ui/ListBox'
import { ResizeHandle } from '../ui/ResizeHandle'
import { useResizable } from '../../hooks/useResizable'

/** Extract the diff for a single file from a combined diff */
function extractFileDiff(fullDiff: string, filePath: string): string {
  const lines = fullDiff.split('\n')
  let capture = false
  const result: string[] = []
  for (const line of lines) {
    if (line.startsWith('diff --git')) {
      if (capture) break
      if (line.includes(`b/${filePath}`)) capture = true
    }
    if (capture) result.push(line)
  }
  return result.join('\n')
}

export function PRCommitsTab() {
  const { projects, activeProjectId } = useProjectStore()
  const { activePRNumber, activeSessionId, sessions } = useSessionStore()
  const { pullRequests } = usePRStore()

  const activeProject = projects.find((p) => p.id === activeProjectId)
  const activeSession = sessions.find((s) => s.id === activeSessionId)
  const sessionPR = activeSession
    ? pullRequests.find((pr) => pr.headRefName === activeSession.branchName)
    : undefined
  const prNumber = activePRNumber ?? sessionPR?.number ?? null

  const {
    commits, selectedCommitHash, commitDiff, files,
    selectedFilePath, comments, viewedFiles, reviewThreads,
    selectCommit, selectFile, addComment, toggleFileViewed,
  } = usePRReviewStore()

  const commitsCol = useResizable({ direction: 'horizontal', initialSize: 260, minSize: 180, maxSize: 450 })
  const filesCol = useResizable({ direction: 'horizontal', initialSize: 240, minSize: 160, maxSize: 400 })

  // Auto-select first commit when entering the tab with nothing selected
  useEffect(() => {
    if (!selectedCommitHash && commits.length > 0 && activeProject) {
      selectCommit(activeProject.repoPath, commits[0].hash)
    }
  }, [commits, selectedCommitHash, activeProject?.repoPath])

  // Files changed in the selected commit, parsed from commitDiff
  const displayFiles = useMemo(() => {
    if (!commitDiff) return []
    const fileSet = new Set<string>()
    for (const line of commitDiff.split('\n')) {
      if (line.startsWith('diff --git')) {
        const match = line.match(/b\/(.+)$/)
        if (match) fileSet.add(match[1])
      }
    }
    // Use the PR file metadata where we have it; fall back to a synthetic entry
    const byPath = new Map(files.map((f) => [f.path, f]))
    return [...fileSet].map((path) =>
      byPath.get(path) ?? { path, additions: 0, deletions: 0, status: 'modified' as const }
    )
  }, [commitDiff, files])

  // When the selected commit changes, ensure a file in that commit is selected
  useEffect(() => {
    if (displayFiles.length === 0) return
    if (!selectedFilePath || !displayFiles.find((f) => f.path === selectedFilePath)) {
      selectFile(displayFiles[0].path)
    }
  }, [displayFiles])

  const unresolvedFiles = useMemo(() => {
    const set = new Set<string>()
    for (const t of reviewThreads) if (!t.isResolved) set.add(t.path)
    return set
  }, [reviewThreads])

  const fileDiff =
    selectedFilePath && commitDiff ? extractFileDiff(commitDiff, selectedFilePath) : ''

  const fileComments = selectedFilePath
    ? comments.filter((c) => c.path === selectedFilePath)
    : []

  const handleAddComment = async (
    startLine: number,
    endLine: number,
    side: 'LEFT' | 'RIGHT',
    body: string,
  ) => {
    if (!selectedFilePath || !activeProject || !prNumber) return
    await addComment(activeProject.repoPath, prNumber, body, selectedFilePath, startLine, endLine, side)
  }

  if (commits.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-xs">
        No commits in this PR
      </div>
    )
  }

  return (
    <div className="flex-1 flex min-h-0">
      {/* Commits sidebar */}
      <div
        style={{ width: commitsCol.size }}
        className="flex-shrink-0 flex flex-col min-h-0 border-r border-border"
      >
        <div
          className="flex items-center bg-bg-tertiary border-b border-border text-xs text-text-muted"
          style={{ padding: '6px 12px' }}
        >
          <span>Commits ({commits.length})</span>
        </div>
        <ListBox
          label="PR commits"
          className="flex-1 overflow-y-auto"
          onSelect={(index) => {
            if (activeProject) selectCommit(activeProject.repoPath, commits[index].hash)
          }}
        >
          {commits.map((commit, i) => (
            <ListItem
              key={commit.hash}
              selected={commit.hash === selectedCommitHash}
              onClick={() => activeProject && selectCommit(activeProject.repoPath, commit.hash)}
              className="border-b border-border text-xs"
              style={{ padding: '8px 12px' }}
            >
              <div className="font-medium truncate">
                {i + 1}. {commit.message}
              </div>
              <div className="flex gap-2 mt-1 text-text-muted text-[10px]">
                <span className="font-mono">{commit.hash.slice(0, 7)}</span>
                <span className="truncate">{commit.author}</span>
                <span>{new Date(commit.date).toLocaleDateString()}</span>
              </div>
            </ListItem>
          ))}
        </ListBox>
      </div>
      <ResizeHandle direction="horizontal" onMouseDown={commitsCol.onMouseDown} />

      {/* File tree for selected commit */}
      <div
        style={{ width: filesCol.size }}
        className="flex-shrink-0 flex flex-col min-h-0 border-r border-border"
      >
        <div
          className="flex items-center bg-bg-tertiary border-b border-border text-xs text-text-muted"
          style={{ padding: '6px 12px' }}
        >
          <span>Files ({displayFiles.length})</span>
        </div>
        <FileTree
          files={displayFiles}
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
            {commitDiff ? 'Select a file' : 'Loading commit diff...'}
          </div>
        )}
      </div>
    </div>
  )
}
