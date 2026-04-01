import React, { useEffect, useState, useCallback } from 'react'
import { useProjectStore } from '../../stores/projectStore'
import { IconButton } from '../ui'
import { useToastStore } from '../../stores/toastStore'

interface Permissions {
  allow: string[]
  deny: string[]
}

/**
 * Format a raw permission string for display.
 * e.g. "Bash(npm install:*)" → "Bash: npm install:*"
 *      "mcp__server__tool"   → "MCP: server / tool"
 *      "WebSearch"           → "WebSearch"
 */
function formatPermission(raw: string): { label: string; type: string } {
  // Bash(command:pattern)
  const bashMatch = raw.match(/^Bash\((.+)\)$/)
  if (bashMatch) return { label: bashMatch[1], type: 'Bash' }

  // MCP tools: mcp__server__tool
  if (raw.startsWith('mcp__')) {
    const parts = raw.slice(5).split('__')
    const tool = parts.pop() ?? ''
    const server = parts.join('/')
    return { label: `${server} / ${tool}`, type: 'MCP' }
  }

  // Read/Write/Edit with path pattern
  const toolMatch = raw.match(/^(Read|Write|Edit)\((.+)\)$/)
  if (toolMatch) return { label: toolMatch[2], type: toolMatch[1] }

  // WebFetch with domain
  const fetchMatch = raw.match(/^WebFetch\((.+)\)$/)
  if (fetchMatch) return { label: fetchMatch[1], type: 'WebFetch' }

  return { label: raw, type: 'Tool' }
}

function PermissionList({
  title,
  items,
  variant,
  onRemove,
}: {
  title: string
  items: string[]
  variant: 'allow' | 'deny'
  onRemove: (item: string) => void
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
      <div>
        {items.map((item) => {
          const { label, type } = formatPermission(item)
          return (
            <div
              key={item}
              className="flex items-center gap-2 group hover:bg-bg-tertiary"
              style={{ padding: '5px 8px 5px 12px' }}
            >
              <span
                className={`text-[10px] font-medium px-1.5 py-0.5 rounded flex-shrink-0 ${
                  variant === 'allow'
                    ? 'bg-success/15 text-success'
                    : 'bg-danger/15 text-danger'
                }`}
              >
                {type}
              </span>
              <span className="text-sm text-text truncate flex-1 min-w-0" title={item}>
                {label}
              </span>
              <IconButton
                label={`Remove ${item}`}
                variant="danger"
                onClick={() => onRemove(item)}
                className="opacity-0 group-hover:opacity-100 flex-shrink-0"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </IconButton>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function PermissionsPanel() {
  const { activeProjectId, projects } = useProjectStore()
  const [permissions, setPermissions] = useState<Permissions>({ allow: [], deny: [] })

  const repoPath = projects.find((p) => p.id === activeProjectId)?.repoPath

  const loadPermissions = useCallback(async () => {
    if (!repoPath) return
    try {
      const perms = await window.api.permissions.get(repoPath)
      setPermissions(perms)
    } catch {
      // Silently fail — file may not exist yet
    }
  }, [repoPath])

  useEffect(() => {
    loadPermissions()
  }, [loadPermissions])

  // Listen for sync-triggered updates
  useEffect(() => {
    const remove = window.api.permissions.onChanged((changedRepoPath, perms) => {
      if (changedRepoPath === repoPath) {
        setPermissions(perms)
      }
    })
    return remove
  }, [repoPath])

  const handleRemove = async (list: 'allow' | 'deny', item: string) => {
    if (!repoPath) return
    const updated = {
      allow: list === 'allow' ? permissions.allow.filter((p) => p !== item) : permissions.allow,
      deny: list === 'deny' ? permissions.deny.filter((p) => p !== item) : permissions.deny,
    }
    try {
      await window.api.permissions.update(repoPath, updated)
      setPermissions(updated)
    } catch (err: any) {
      useToastStore.getState().addToast('error', err.message)
    }
  }

  if (!activeProjectId) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <p className="text-text-muted text-xs text-center">Select a project to see permissions</p>
      </div>
    )
  }

  const isEmpty = permissions.allow.length === 0 && permissions.deny.length === 0

  if (isEmpty) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <p className="text-text-muted text-xs text-center leading-relaxed">
          No shared permissions yet.
          <br />
          Permissions granted via &ldquo;Allow Always&rdquo; in any session will appear here.
        </p>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div
        className="flex items-center justify-between border-b border-border flex-shrink-0"
        style={{ padding: '6px 8px 6px 12px' }}
      >
        <span className="text-xs text-text-muted">
          {permissions.allow.length + permissions.deny.length} rules
        </span>
        <IconButton label="Refresh permissions" onClick={loadPermissions}>
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

      <div className="flex-1 overflow-y-auto">
        <PermissionList
          title="Allowed"
          items={permissions.allow}
          variant="allow"
          onRemove={(item) => handleRemove('allow', item)}
        />
        <PermissionList
          title="Denied"
          items={permissions.deny}
          variant="deny"
          onRemove={(item) => handleRemove('deny', item)}
        />
      </div>
    </div>
  )
}
