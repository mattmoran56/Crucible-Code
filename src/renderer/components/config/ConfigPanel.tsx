import React, { useEffect, useState, useCallback } from 'react'
import { useProjectStore } from '../../stores/projectStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useConfigStore } from '../../stores/configStore'
import { useEditorStore } from '../../stores/editorStore'
import { IconButton, Button } from '../ui'
import { ConfigItemRow } from './ConfigItemRow'
import { CreateConfigDialog } from './CreateConfigDialog'
import { useToastStore } from '../../stores/toastStore'
import type { ConfigItem, ConfigTrackingMode } from '../../../shared/types'

function ConfigSection({
  title,
  items,
  onSelect,
  onToggleTracking,
  onDelete,
}: {
  title: string
  items: ConfigItem[]
  onSelect: (itemId: string) => void
  onToggleTracking: (itemId: string, mode: ConfigTrackingMode) => void
  onDelete: (itemId: string) => void
}) {
  if (items.length === 0) return null

  return (
    <div>
      <div
        className="text-xs font-medium text-text-muted uppercase tracking-wide"
        style={{ padding: '8px 12px 4px' }}
      >
        {title} ({items.length})
      </div>
      <div role="listbox">
        {items.map((item) => (
          <ConfigItemRow
            key={item.id}
            item={item}
            onSelect={onSelect}
            onToggleTracking={onToggleTracking}
            onDelete={onDelete}
          />
        ))}
      </div>
    </div>
  )
}

function ClaudePromptSection() {
  const [copied, setCopied] = useState(false)

  const prompt = `I want to add Claude Code configuration to this project. Create files in your current working directory using these paths:

- **Commands/Skills**: .claude/commands/<name>.md — each file becomes a slash command (e.g. /my-skill)
- **Project instructions**: CLAUDE.md at the repo root
- **Additional instructions**: .claude/CLAUDE.md

These files are managed by CodeCrucible and will be automatically synced across all sessions. They are excluded from git by default but can be shared with the team if needed.

Please help me create the config I describe next.`

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      useToastStore.getState().addToast('error', 'Failed to copy to clipboard')
    }
  }

  return (
    <div className="border-t border-border flex-shrink-0" style={{ padding: '10px 12px' }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
        <span className="text-xs font-medium text-text-muted uppercase tracking-wide">
          Add using Claude
        </span>
      </div>
      <p className="text-xs text-text-muted leading-relaxed" style={{ marginBottom: 8 }}>
        Copy this prompt into a Claude session, then describe the skill or config you want. Claude will create the files in the right location.
      </p>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleCopy}
        className="w-full"
      >
        {copied ? 'Copied!' : 'Copy prompt to clipboard'}
      </Button>
    </div>
  )
}

export function ConfigPanel() {
  const { activeProjectId, projects } = useProjectStore()
  const { activeSessionId, sessions } = useSessionStore()
  const { openFile, setEditorMode } = useEditorStore()
  const {
    items,
    loading,
    loadItems,
    setTracking,
    createCommand,
    createClaudeMd,
    deleteItem,
    updateItems,
  } = useConfigStore()
  const [showCreateDialog, setShowCreateDialog] = useState(false)

  const activeProject = projects.find((p) => p.id === activeProjectId)
  const repoPath = activeProject?.repoPath
  const activeSession = sessions.find((s) => s.id === activeSessionId)
  // Use the active session's worktree, fall back to main repo
  const worktreePath = activeSession?.worktreePath ?? repoPath

  const load = useCallback(async () => {
    if (!repoPath) return
    await loadItems(repoPath)
  }, [repoPath, loadItems])

  useEffect(() => {
    load()
  }, [load])

  // Listen for sync-triggered updates
  useEffect(() => {
    const remove = window.api.config.onChanged((changedRepoPath, newItems) => {
      if (changedRepoPath === repoPath) {
        updateItems(newItems)
      }
    })
    return remove
  }, [repoPath, updateItems])

  const handleSelect = (itemId: string) => {
    if (!worktreePath || !repoPath) return

    // Find the item to get its relative path
    const item = items.find((i) => i.id === itemId)
    if (!item) return

    // For hooks, there's no file to open
    if (item.type === 'hook') return

    // Resolve the absolute file path in the worktree
    const absPath = `${worktreePath}/${item.relativePath}`

    // Switch to editor mode and open the file
    setEditorMode(true)
    openFile(absPath, worktreePath)
  }

  const handleToggleTracking = (itemId: string, mode: ConfigTrackingMode) => {
    if (!repoPath) return
    setTracking(repoPath, itemId, mode)
  }

  const handleDelete = (itemId: string) => {
    if (!repoPath) return
    deleteItem(repoPath, itemId)
  }

  const handleCreate = (type: string, name: string, content: string) => {
    if (!repoPath) return
    if (type === 'command') {
      createCommand(repoPath, name, content)
    } else if (type === 'claudemd-root') {
      createClaudeMd(repoPath, 'root', content)
    } else if (type === 'claudemd-claude') {
      createClaudeMd(repoPath, '.claude', content)
    }
  }

  if (!activeProjectId) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <p className="text-text-muted text-xs text-center">Select a project to see config</p>
      </div>
    )
  }

  const commands = items.filter((i) => i.type === 'command')
  const hooks = items.filter((i) => i.type === 'hook')
  const claudeMds = items.filter((i) => i.type === 'claudemd')
  const existingTypes = new Set(items.map((i) => i.id))

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Toolbar */}
      <div
        className="flex items-center justify-between border-b border-border flex-shrink-0"
        style={{ padding: '6px 8px 6px 12px' }}
      >
        <span className="text-xs text-text-muted">
          {items.length} item{items.length !== 1 ? 's' : ''}
        </span>
        <div className="flex items-center gap-1">
          <IconButton label="Add config item" onClick={() => setShowCreateDialog(true)}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </IconButton>
          <IconButton label="Refresh config" onClick={load}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </IconButton>
        </div>
      </div>

      {/* Item list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {items.length === 0 && !loading ? (
          <div className="flex items-center justify-center p-4" style={{ minHeight: 80 }}>
            <p className="text-text-muted text-xs text-center leading-relaxed">
              No Claude config items found.
              <br />
              Use the + button or &ldquo;Add using Claude&rdquo; below.
            </p>
          </div>
        ) : (
          <>
            <ConfigSection
              title="Commands"
              items={commands}
              onSelect={handleSelect}
              onToggleTracking={handleToggleTracking}
              onDelete={handleDelete}
            />
            <ConfigSection
              title="CLAUDE.md"
              items={claudeMds}
              onSelect={handleSelect}
              onToggleTracking={handleToggleTracking}
              onDelete={handleDelete}
            />
            <ConfigSection
              title="Hooks"
              items={hooks}
              onSelect={handleSelect}
              onToggleTracking={handleToggleTracking}
              onDelete={handleDelete}
            />
          </>
        )}
      </div>

      {/* Add using Claude section — always at bottom */}
      <ClaudePromptSection />

      <CreateConfigDialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onCreate={handleCreate}
        existingTypes={existingTypes}
      />
    </div>
  )
}
