import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useEditorStore } from '../../stores/editorStore'
import { IconButton } from '../ui/IconButton'
import { Dialog } from '../ui/Dialog'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'
import type { FileEntry } from '../../../shared/types'

interface FileExplorerProps {
  repoPath: string
}

export function FileExplorer({ repoPath }: FileExplorerProps) {
  const { activeFilePath, openFile } = useEditorStore()
  const [entries, setEntries] = useState<Map<string, FileEntry[]>>(new Map())
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [showNewFile, setShowNewFile] = useState(false)
  const [newFilePath, setNewFilePath] = useState('')
  const treeRef = useRef<HTMLDivElement>(null)

  // Load root directory on mount
  useEffect(() => {
    loadDirectory(repoPath)
  }, [repoPath])

  // File watcher
  useEffect(() => {
    window.api.file.watch(repoPath)
    const removeListener = window.api.file.onChanged((filePath: string) => {
      // Find which directory needs refreshing
      const dir = filePath.substring(0, filePath.lastIndexOf('/'))
      if (entries.has(dir) || dir === repoPath) {
        loadDirectory(dir || repoPath)
      }
    })
    return () => {
      window.api.file.unwatch(repoPath)
      removeListener()
    }
  }, [repoPath])

  const loadDirectory = useCallback(async (dirPath: string) => {
    try {
      const items = await window.api.file.listDir(dirPath)
      setEntries((prev) => {
        const next = new Map(prev)
        next.set(dirPath, items)
        return next
      })
    } catch {
      // Directory may not exist
    }
  }, [])

  const toggleDir = useCallback(
    (dirPath: string) => {
      setExpandedDirs((prev) => {
        const next = new Set(prev)
        if (next.has(dirPath)) {
          next.delete(dirPath)
        } else {
          next.add(dirPath)
          if (!entries.has(dirPath)) {
            loadDirectory(dirPath)
          }
        }
        return next
      })
    },
    [entries, loadDirectory]
  )

  const handleFileClick = useCallback(
    (filePath: string) => {
      setSelectedPath(filePath)
      openFile(filePath, repoPath)
    },
    [openFile, repoPath]
  )

  const handleCreateFile = useCallback(async () => {
    if (!newFilePath.trim()) return
    const fullPath = newFilePath.startsWith('/')
      ? newFilePath
      : `${repoPath}/${newFilePath}`
    const { createNewFile } = useEditorStore.getState()
    await createNewFile(fullPath, repoPath)
    // Refresh parent directory
    const dir = fullPath.substring(0, fullPath.lastIndexOf('/'))
    loadDirectory(dir)
    setShowNewFile(false)
    setNewFilePath('')
  }, [newFilePath, repoPath, loadDirectory])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!treeRef.current) return
      const items = treeRef.current.querySelectorAll<HTMLElement>('[data-tree-item]')
      const arr = Array.from(items)
      const currentIdx = arr.findIndex((el) => el.dataset.treePath === selectedPath)

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        const next = arr[currentIdx + 1]
        if (next) {
          setSelectedPath(next.dataset.treePath ?? null)
          next.focus()
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        const prev = arr[currentIdx - 1]
        if (prev) {
          setSelectedPath(prev.dataset.treePath ?? null)
          prev.focus()
        }
      } else if (e.key === 'ArrowRight' && selectedPath) {
        // Expand directory
        const entry = findEntry(selectedPath)
        if (entry?.isDirectory && !expandedDirs.has(selectedPath)) {
          toggleDir(selectedPath)
        }
      } else if (e.key === 'ArrowLeft' && selectedPath) {
        // Collapse directory
        const entry = findEntry(selectedPath)
        if (entry?.isDirectory && expandedDirs.has(selectedPath)) {
          toggleDir(selectedPath)
        }
      } else if (e.key === 'Enter' && selectedPath) {
        const entry = findEntry(selectedPath)
        if (entry?.isDirectory) {
          toggleDir(selectedPath)
        } else if (entry) {
          handleFileClick(selectedPath)
        }
      }
    },
    [selectedPath, expandedDirs, toggleDir, handleFileClick]
  )

  const findEntry = (path: string): FileEntry | undefined => {
    for (const [, items] of entries) {
      const found = items.find((e) => e.path === path)
      if (found) return found
    }
    return undefined
  }

  const rootEntries = entries.get(repoPath) ?? []

  return (
    <div className="flex flex-col h-full bg-bg-secondary">
      {/* Header */}
      <div
        className="flex items-center justify-between border-b border-border flex-shrink-0"
        style={{ padding: '8px 10px' }}
      >
        <span className="text-xs font-medium text-text-muted uppercase tracking-wide">
          Files
        </span>
        <IconButton label="New file" onClick={() => setShowNewFile(true)} className="text-accent hover:text-accent-hover">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="12" y1="18" x2="12" y2="12" />
            <line x1="9" y1="15" x2="15" y2="15" />
          </svg>
        </IconButton>
      </div>

      {/* Tree */}
      <div
        ref={treeRef}
        className="flex-1 overflow-auto text-xs"
        role="tree"
        onKeyDown={handleKeyDown}
        style={{ padding: '4px 0' }}
      >
        {rootEntries.map((entry) => (
          <TreeNode
            key={entry.path}
            entry={entry}
            depth={0}
            entries={entries}
            expandedDirs={expandedDirs}
            selectedPath={selectedPath}
            activeFilePath={activeFilePath}
            onToggleDir={toggleDir}
            onFileClick={handleFileClick}
          />
        ))}
      </div>

      {/* New File Dialog */}
      <Dialog open={showNewFile} onClose={() => setShowNewFile(false)} title="New File">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleCreateFile()
          }}
        >
          <Input
            label="File path (relative to repo root)"
            value={newFilePath}
            onChange={(e) => setNewFilePath(e.target.value)}
            placeholder="src/example.ts"
            autoFocus
          />
          <div className="flex justify-end gap-2" style={{ marginTop: 12 }}>
            <Button variant="ghost" size="sm" onClick={() => setShowNewFile(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" type="submit" disabled={!newFilePath.trim()}>
              Create
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}

/* ── Tree Node ────────────────────────────────────────── */

function TreeNode({
  entry,
  depth,
  entries,
  expandedDirs,
  selectedPath,
  activeFilePath,
  onToggleDir,
  onFileClick,
}: {
  entry: FileEntry
  depth: number
  entries: Map<string, FileEntry[]>
  expandedDirs: Set<string>
  selectedPath: string | null
  activeFilePath: string | null
  onToggleDir: (path: string) => void
  onFileClick: (path: string) => void
}) {
  const isExpanded = expandedDirs.has(entry.path)
  const isSelected = selectedPath === entry.path
  const isActive = activeFilePath === entry.path
  const children = entries.get(entry.path) ?? []

  return (
    <>
      <div
        role="treeitem"
        aria-expanded={entry.isDirectory ? isExpanded : undefined}
        aria-selected={isSelected}
        data-tree-item
        data-tree-path={entry.path}
        tabIndex={isSelected ? 0 : -1}
        className={`flex items-center gap-1 cursor-pointer select-none
          hover:bg-bg-tertiary transition-colors
          ${isActive ? 'bg-accent/15 text-accent' : isSelected ? 'bg-bg-tertiary text-text' : 'text-text'}
        `}
        style={{ padding: '3px 8px', paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => {
          if (entry.isDirectory) {
            onToggleDir(entry.path)
          } else {
            onFileClick(entry.path)
          }
        }}
      >
        {/* Chevron for directories */}
        {entry.isDirectory ? (
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`flex-shrink-0 text-text-muted transition-transform ${isExpanded ? 'rotate-90' : ''}`}
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        ) : (
          <span className="w-3 flex-shrink-0" />
        )}

        {/* Icon */}
        {entry.isDirectory ? (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="flex-shrink-0 text-text-muted"
          >
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
        ) : (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="flex-shrink-0 text-text-muted"
          >
            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        )}

        {/* Name */}
        <span className="truncate">{entry.name}</span>
      </div>

      {/* Children */}
      {entry.isDirectory && isExpanded && (
        <div role="group">
          {children.map((child) => (
            <TreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              entries={entries}
              expandedDirs={expandedDirs}
              selectedPath={selectedPath}
              activeFilePath={activeFilePath}
              onToggleDir={onToggleDir}
              onFileClick={onFileClick}
            />
          ))}
          {children.length === 0 && (
            <div
              className="text-text-muted italic"
              style={{ padding: '3px 8px', paddingLeft: `${(depth + 1) * 16 + 8}px` }}
            >
              Empty
            </div>
          )}
        </div>
      )}
    </>
  )
}
