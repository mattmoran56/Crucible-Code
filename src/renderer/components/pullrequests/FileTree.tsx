import React, { useMemo, useState } from 'react'
import type { PRFile } from '../../../shared/types'

interface FileTreeNode {
  name: string
  fullPath: string
  children: FileTreeNode[]
  file?: PRFile
}

function buildFileTree(files: PRFile[]): FileTreeNode[] {
  const root: FileTreeNode = { name: '', fullPath: '', children: [] }

  for (const file of files) {
    const parts = file.path.split('/')
    let current = root

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isFile = i === parts.length - 1
      const fullPath = parts.slice(0, i + 1).join('/')

      let child = current.children.find((c) => c.name === part)
      if (!child) {
        child = { name: part, fullPath, children: [], file: isFile ? file : undefined }
        current.children.push(child)
      }
      current = child
    }
  }

  // Collapse single-child directories (e.g., src/renderer -> src/renderer)
  function collapse(node: FileTreeNode): FileTreeNode {
    if (node.children.length === 1 && !node.children[0].file) {
      const child = node.children[0]
      return collapse({
        name: node.name ? `${node.name}/${child.name}` : child.name,
        fullPath: child.fullPath,
        children: child.children,
      })
    }
    return { ...node, children: node.children.map(collapse) }
  }

  const collapsed = collapse(root)

  // Sort: directories first, then files, both alphabetical
  function sortTree(nodes: FileTreeNode[]): FileTreeNode[] {
    return nodes.sort((a, b) => {
      const aIsDir = !a.file
      const bIsDir = !b.file
      if (aIsDir !== bIsDir) return aIsDir ? -1 : 1
      return a.name.localeCompare(b.name)
    }).map((n) => ({ ...n, children: sortTree(n.children) }))
  }

  return sortTree(collapsed.children)
}

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

interface FileTreeProps {
  files: PRFile[]
  selectedFilePath: string | null
  viewedFiles: Set<string>
  unresolvedFiles?: Set<string>
  onSelectFile: (path: string) => void
  onToggleViewed: (path: string) => void
}

export function FileTree({ files, selectedFilePath, viewedFiles, unresolvedFiles, onSelectFile, onToggleViewed }: FileTreeProps) {
  const tree = useMemo(() => buildFileTree(files), [files])
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const toggleCollapse = (path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }

  return (
    <div role="tree" aria-label="PR files" className="flex-1 overflow-y-auto">
      {tree.map((node) => (
        <TreeNode
          key={node.fullPath}
          node={node}
          depth={0}
          collapsed={collapsed}
          selectedFilePath={selectedFilePath}
          viewedFiles={viewedFiles}
          unresolvedFiles={unresolvedFiles}
          onSelectFile={onSelectFile}
          onToggleViewed={onToggleViewed}
          onToggleCollapse={toggleCollapse}
        />
      ))}
    </div>
  )
}

interface TreeNodeProps {
  node: FileTreeNode
  depth: number
  collapsed: Set<string>
  selectedFilePath: string | null
  viewedFiles: Set<string>
  unresolvedFiles?: Set<string>
  onSelectFile: (path: string) => void
  onToggleViewed: (path: string) => void
  onToggleCollapse: (path: string) => void
}

function TreeNode({
  node, depth, collapsed, selectedFilePath, viewedFiles, unresolvedFiles,
  onSelectFile, onToggleViewed, onToggleCollapse,
}: TreeNodeProps) {
  const isDir = !node.file
  const isCollapsed = collapsed.has(node.fullPath)
  const isSelected = node.file?.path === selectedFilePath
  const isViewed = node.file ? viewedFiles.has(node.file.path) : false
  const hasUnresolved = node.file ? unresolvedFiles?.has(node.file.path) : false

  if (isDir) {
    return (
      <>
        <div
          role="treeitem"
          aria-expanded={!isCollapsed}
          className="flex items-center gap-1 text-xs text-text-muted cursor-pointer hover:bg-bg-tertiary select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
          style={{ padding: '4px 12px', paddingLeft: 12 + depth * 16 }}
          tabIndex={0}
          onClick={() => onToggleCollapse(node.fullPath)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onToggleCollapse(node.fullPath)
            }
          }}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="currentColor"
            className={`flex-shrink-0 transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
          >
            <path d="M3 1l5 4-5 4V1z" />
          </svg>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="flex-shrink-0 text-accent">
            <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h3.172a1.5 1.5 0 0 1 1.06.44l.829.828a.5.5 0 0 0 .354.147H13.5A1.5 1.5 0 0 1 15 4.915V12.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5v-9z" />
          </svg>
          <span className="truncate">{node.name}</span>
        </div>
        {!isCollapsed && node.children.map((child) => (
          <TreeNode
            key={child.fullPath}
            node={child}
            depth={depth + 1}
            collapsed={collapsed}
            selectedFilePath={selectedFilePath}
            viewedFiles={viewedFiles}
            unresolvedFiles={unresolvedFiles}
            onSelectFile={onSelectFile}
            onToggleViewed={onToggleViewed}
            onToggleCollapse={onToggleCollapse}
          />
        ))}
      </>
    )
  }

  // File leaf node
  const file = node.file!
  return (
    <div
      role="treeitem"
      aria-selected={isSelected}
      className={`flex items-center gap-2 text-xs cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset ${
        isSelected ? 'bg-accent/10 text-accent' : 'hover:bg-bg-tertiary'
      } ${isViewed ? 'opacity-60' : ''}`}
      style={{ padding: '6px 12px', paddingLeft: 12 + depth * 16 }}
      tabIndex={0}
      onClick={() => onSelectFile(file.path)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelectFile(file.path)
        }
      }}
    >
      <button
        className="flex-shrink-0 text-text-muted hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
        onClick={(e) => {
          e.stopPropagation()
          onToggleViewed(file.path)
        }}
        title={isViewed ? 'Mark as unviewed' : 'Mark as viewed'}
        aria-label={isViewed ? `Mark ${file.path} as unviewed` : `Mark ${file.path} as viewed`}
      >
        {isViewed ? (
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="text-accent">
            <path d="M8 2C4.5 2 1.6 4.3.3 7.5a.5.5 0 0 0 0 .4C1.6 11.2 4.5 13.5 8 13.5s6.4-2.3 7.7-5.6a.5.5 0 0 0 0-.4C14.4 4.3 11.5 2 8 2zm0 9.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7zM8 6a1.75 1.75 0 1 0 0 3.5A1.75 1.75 0 0 0 8 6z"/>
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
            <path d="M8 3.5C4.8 3.5 2.1 5.6.8 7.7a.5.5 0 0 0 0 .6C2.1 10.4 4.8 12.5 8 12.5s5.9-2.1 7.2-4.2a.5.5 0 0 0 0-.6C13.9 5.6 11.2 3.5 8 3.5z"/>
            <circle cx="8" cy="8" r="2.5"/>
          </svg>
        )}
      </button>
      <span className={`font-mono font-bold ${STATUS_COLORS[file.status] || 'text-warning'}`}>
        {STATUS_LABELS[file.status] || 'M'}
      </span>
      <span className="truncate">{node.name}</span>
      {hasUnresolved && (
        <span className="flex-shrink-0 w-2 h-2 rounded-full bg-danger" title="Has unresolved comments" />
      )}
      <span className="ml-auto flex gap-1 text-[10px]">
        {file.additions > 0 && <span className="text-success">+{file.additions}</span>}
        {file.deletions > 0 && <span className="text-danger">-{file.deletions}</span>}
      </span>
    </div>
  )
}
