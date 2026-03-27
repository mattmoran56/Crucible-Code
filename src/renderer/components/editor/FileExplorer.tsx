import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useEditorStore } from '../../stores/editorStore'
import { useToastStore } from '../../stores/toastStore'
import { IconButton } from '../ui/IconButton'
import type { FileEntry } from '../../../shared/types'

const DRAG_MIME = 'application/x-file-tree'

interface FileExplorerProps {
  repoPath: string
}

export function FileExplorer({ repoPath }: FileExplorerProps) {
  const { activeFilePath, openFile } = useEditorStore()
  const [entries, setEntries] = useState<Map<string, FileEntry[]>>(new Map())
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [creatingInDir, setCreatingInDir] = useState<string | null>(null)
  const [newFileName, setNewFileName] = useState('')
  const [dragOverDir, setDragOverDir] = useState<string | null>(null)
  const treeRef = useRef<HTMLDivElement>(null)

  // Load root directory on mount
  useEffect(() => {
    loadDirectory(repoPath)
  }, [repoPath])

  // File watcher
  useEffect(() => {
    window.api.file.watch(repoPath)
    const removeListener = window.api.file.onChanged((filePath: string) => {
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

  const handleStartCreate = useCallback((dirPath: string) => {
    // Expand the directory first
    setExpandedDirs((prev) => {
      const next = new Set(prev)
      next.add(dirPath)
      if (!entries.has(dirPath)) {
        loadDirectory(dirPath)
      }
      return next
    })
    setCreatingInDir(dirPath)
    setNewFileName('')
  }, [entries, loadDirectory])

  const handleConfirmCreate = useCallback(async () => {
    if (!newFileName.trim() || !creatingInDir) return
    const { addToast } = useToastStore.getState()
    const fullPath = `${creatingInDir}/${newFileName.trim()}`
    try {
      await window.api.file.create(fullPath, repoPath)
      await loadDirectory(creatingInDir)
      // Open the new file
      const { forceOpenFile } = useEditorStore.getState()
      await forceOpenFile(fullPath, repoPath)
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : String(err))
    }
    setCreatingInDir(null)
    setNewFileName('')
  }, [newFileName, creatingInDir, repoPath, loadDirectory])

  const handleCancelCreate = useCallback(() => {
    setCreatingInDir(null)
    setNewFileName('')
  }, [])

  const handleDrop = useCallback(async (targetDir: string, sourcePath: string) => {
    const { addToast } = useToastStore.getState()
    const fileName = sourcePath.split('/').pop()
    if (!fileName) return
    const newPath = `${targetDir}/${fileName}`
    if (newPath === sourcePath) return

    try {
      await window.api.file.move(sourcePath, newPath, repoPath)
      // Refresh both source and target directories
      const sourceDir = sourcePath.substring(0, sourcePath.lastIndexOf('/'))
      await Promise.all([loadDirectory(sourceDir), loadDirectory(targetDir)])
      // Update open file path if it was moved
      const { openFiles, setActiveFile } = useEditorStore.getState()
      const wasOpen = openFiles.find((f) => f.path === sourcePath)
      if (wasOpen) {
        // Close old, open new
        useEditorStore.getState().closeFile(sourcePath)
        useEditorStore.getState().forceOpenFile(newPath, repoPath)
      }
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : String(err))
    }
    setDragOverDir(null)
  }, [repoPath, loadDirectory])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (creatingInDir) return // Don't navigate while creating
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
        const entry = findEntry(selectedPath)
        if (entry?.isDirectory && !expandedDirs.has(selectedPath)) {
          toggleDir(selectedPath)
        }
      } else if (e.key === 'ArrowLeft' && selectedPath) {
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
    [selectedPath, expandedDirs, toggleDir, handleFileClick, creatingInDir]
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
        <IconButton label="New file in root" onClick={() => handleStartCreate(repoPath)} className="text-accent hover:text-accent-hover">
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
            creatingInDir={creatingInDir}
            newFileName={newFileName}
            dragOverDir={dragOverDir}
            onToggleDir={toggleDir}
            onFileClick={handleFileClick}
            onStartCreate={handleStartCreate}
            onNewFileNameChange={setNewFileName}
            onConfirmCreate={handleConfirmCreate}
            onCancelCreate={handleCancelCreate}
            onDrop={handleDrop}
            onDragOverDir={setDragOverDir}
          />
        ))}
        {/* Inline creation for root */}
        {creatingInDir === repoPath && (
          <InlineNewFile
            depth={0}
            value={newFileName}
            onChange={setNewFileName}
            onConfirm={handleConfirmCreate}
            onCancel={handleCancelCreate}
          />
        )}
      </div>
    </div>
  )
}

/* ── Inline New File Input ────────────────────────────── */

function InlineNewFile({
  depth,
  value,
  onChange,
  onConfirm,
  onCancel,
}: {
  depth: number
  value: string
  onChange: (v: string) => void
  onConfirm: () => void
  onCancel: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <div
      className="flex items-center gap-1"
      style={{ padding: '2px 8px', paddingLeft: `${depth * 16 + 8 + 28}px` }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 text-text-muted">
        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onConfirm()
          if (e.key === 'Escape') onCancel()
          e.stopPropagation()
        }}
        onBlur={onCancel}
        className="flex-1 bg-bg text-text text-xs border border-accent rounded outline-none min-w-0"
        style={{ padding: '1px 4px' }}
        placeholder="filename.ts"
      />
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
  creatingInDir,
  newFileName,
  dragOverDir,
  onToggleDir,
  onFileClick,
  onStartCreate,
  onNewFileNameChange,
  onConfirmCreate,
  onCancelCreate,
  onDrop,
  onDragOverDir,
}: {
  entry: FileEntry
  depth: number
  entries: Map<string, FileEntry[]>
  expandedDirs: Set<string>
  selectedPath: string | null
  activeFilePath: string | null
  creatingInDir: string | null
  newFileName: string
  dragOverDir: string | null
  onToggleDir: (path: string) => void
  onFileClick: (path: string) => void
  onStartCreate: (dirPath: string) => void
  onNewFileNameChange: (v: string) => void
  onConfirmCreate: () => void
  onCancelCreate: () => void
  onDrop: (targetDir: string, sourcePath: string) => void
  onDragOverDir: (dir: string | null) => void
}) {
  const isExpanded = expandedDirs.has(entry.path)
  const isSelected = selectedPath === entry.path
  const isActive = activeFilePath === entry.path
  const isDragTarget = dragOverDir === entry.path
  const children = entries.get(entry.path) ?? []

  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.dataTransfer.setData(DRAG_MIME, entry.path)
    e.dataTransfer.effectAllowed = 'move'
  }, [entry.path])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!entry.isDirectory) return
    if (!e.dataTransfer.types.includes(DRAG_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    onDragOverDir(entry.path)
  }, [entry.isDirectory, entry.path, onDragOverDir])

  const handleDragLeave = useCallback(() => {
    onDragOverDir(null)
  }, [onDragOverDir])

  const handleDropOnDir = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const sourcePath = e.dataTransfer.getData(DRAG_MIME)
    if (sourcePath && entry.isDirectory) {
      onDrop(entry.path, sourcePath)
    }
    onDragOverDir(null)
  }, [entry.path, entry.isDirectory, onDrop, onDragOverDir])

  return (
    <>
      <div
        role="treeitem"
        aria-expanded={entry.isDirectory ? isExpanded : undefined}
        aria-selected={isSelected}
        data-tree-item
        data-tree-path={entry.path}
        tabIndex={isSelected ? 0 : -1}
        draggable
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDropOnDir}
        className={`flex items-center gap-1 cursor-pointer select-none group
          hover:bg-bg-tertiary transition-colors
          ${isActive ? 'bg-accent/15 text-accent' : isSelected ? 'bg-bg-tertiary text-text' : 'text-text'}
          ${isDragTarget ? 'ring-1 ring-inset ring-accent/50 bg-accent/10' : ''}
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
        <span className="truncate flex-1">{entry.name}</span>

        {/* New file button on directories */}
        {entry.isDirectory && (
          <span
            className="opacity-0 group-hover:opacity-100 flex-shrink-0 text-text-muted hover:text-accent transition-opacity"
            onClick={(e) => {
              e.stopPropagation()
              onStartCreate(entry.path)
            }}
            role="button"
            aria-label={`New file in ${entry.name}`}
            tabIndex={-1}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </span>
        )}
      </div>

      {/* Children + inline create */}
      {entry.isDirectory && isExpanded && (
        <div role="group">
          {/* Inline new file input */}
          {creatingInDir === entry.path && (
            <InlineNewFile
              depth={depth + 1}
              value={newFileName}
              onChange={onNewFileNameChange}
              onConfirm={onConfirmCreate}
              onCancel={onCancelCreate}
            />
          )}
          {children.map((child) => (
            <TreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              entries={entries}
              expandedDirs={expandedDirs}
              selectedPath={selectedPath}
              activeFilePath={activeFilePath}
              creatingInDir={creatingInDir}
              newFileName={newFileName}
              dragOverDir={dragOverDir}
              onToggleDir={onToggleDir}
              onFileClick={onFileClick}
              onStartCreate={onStartCreate}
              onNewFileNameChange={onNewFileNameChange}
              onConfirmCreate={onConfirmCreate}
              onCancelCreate={onCancelCreate}
              onDrop={onDrop}
              onDragOverDir={onDragOverDir}
            />
          ))}
          {children.length === 0 && creatingInDir !== entry.path && (
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
