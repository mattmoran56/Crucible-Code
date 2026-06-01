import http from 'node:http'
import { URL } from 'node:url'
import { app, BrowserWindow } from 'electron'
import { IPC } from '../../shared/constants'
import type { HookType, ContextKind } from '../../shared/types'
import { showNotification } from './notification.service'
import { emitToRenderer } from './event-bus'

interface ContextMapping {
  contextId: string
  name: string
  kind: ContextKind
  projectId: string
  /** Path used as a fallback for hooks fired from older terminals without env-var routing */
  worktreePath: string
}

let server: http.Server | null = null
let serverPort: number | null = null
let mainWindow: BrowserWindow | null = null
const contextMappings = new Map<string, ContextMapping>()

export function getNotificationServerPort(): number | null {
  return serverPort
}

export function setBadgeCount(count: number) {
  if (process.platform === 'darwin') {
    app.dock.setBadge(count > 0 ? String(count) : '')
  } else {
    app.setBadgeCount(count)
  }
}

export function registerContextMapping(mapping: ContextMapping) {
  contextMappings.set(mapping.contextId, mapping)
}

export function removeContextMapping(contextId: string) {
  contextMappings.delete(contextId)
}

export function findContextById(contextId: string): ContextMapping | undefined {
  return contextMappings.get(contextId)
}

function findContextByWorktreePath(cwd: string): ContextMapping | undefined {
  const normalizedCwd = cwd.replace(/\/+$/, '')
  // Direct match first
  for (const mapping of contextMappings.values()) {
    const normalizedPath = mapping.worktreePath.replace(/\/+$/, '')
    if (normalizedPath === normalizedCwd) return mapping
  }
  // Subdirectory match — prefer the longest matching worktree path so a session
  // worktree wins over the repo-level Code context when both could match.
  let best: ContextMapping | undefined
  let bestLen = -1
  for (const mapping of contextMappings.values()) {
    const normalizedPath = mapping.worktreePath.replace(/\/+$/, '')
    if (normalizedCwd.startsWith(normalizedPath + '/') && normalizedPath.length > bestLen) {
      best = mapping
      bestLen = normalizedPath.length
    }
  }
  return best
}

function tabDisplayLabel(tabId: string): string {
  if (tabId === 'agent') return 'Agent'
  if (tabId === 'review') return 'Review'
  if (tabId.startsWith('agent:')) return `Agent ${tabId.slice(6)}`
  if (tabId.startsWith('terminal:')) return `Terminal ${tabId.slice(9)}`
  return tabId
}

function contextDisplayPrefix(mapping: ContextMapping): string {
  if (mapping.kind === 'session') return `Session "${mapping.name}"`
  if (mapping.kind === 'code') return `Code — ${mapping.name}`
  if (mapping.kind === 'pr') return mapping.name
  return mapping.name
}

export function handleHookEvent(
  contextId: string,
  tabId: string,
  hookType: HookType
) {
  if (!mainWindow) return

  // Send typed status event to the renderer AND the event bus so the embedded
  // relay bridge can fan it out to a connected remote PWA (mobile sidebar).
  emitToRenderer(mainWindow, IPC.NOTIFICATION_SESSION_STATUS, contextId, tabId, hookType)

  const mapping = contextMappings.get(contextId)
  if (!mapping) return

  // OS notifications only for attention and completed — not for running
  if (hookType === 'notification') {
    showNotification(
      'Crucible Code',
      `${contextDisplayPrefix(mapping)} · ${tabDisplayLabel(tabId)} needs your attention`,
      { contextId, tabId }
    )
  } else if (hookType === 'stop') {
    showNotification(
      'Crucible Code',
      `${contextDisplayPrefix(mapping)} · ${tabDisplayLabel(tabId)} is done`,
      { contextId, tabId }
    )
  }
}

export function startNotificationServer(window: BrowserWindow): Promise<number> {
  mainWindow = window

  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      // Typed endpoint: POST /hook?type=prompt|notification|stop&context=...&tab=...
      if (req.method === 'POST' && req.url?.startsWith('/hook')) {
        let body = ''
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString()
        })
        req.on('end', () => {
          try {
            const data = JSON.parse(body)
            const cwd = data.cwd || ''
            const url = new URL(req.url!, `http://127.0.0.1`)
            const hookType = (url.searchParams.get('type') || 'notification') as HookType
            const contextParam = url.searchParams.get('context') || ''
            const tabParam = url.searchParams.get('tab') || 'agent'

            // Prefer explicit context param (env-var-routed); fall back to cwd lookup
            // for legacy terminals that started before the env vars were wired up.
            let mapping = contextParam ? contextMappings.get(contextParam) : undefined
            if (!mapping) {
              mapping = findContextByWorktreePath(cwd)
            }

            if (mapping) {
              handleHookEvent(mapping.contextId, tabParam, hookType)
            }

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true }))
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'invalid json' }))
          }
        })
      } else if (req.method === 'POST' && req.url === '/notification') {
        // Legacy endpoint — treat as notification type, route by cwd
        let body = ''
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString()
        })
        req.on('end', () => {
          try {
            const data = JSON.parse(body)
            const cwd = data.cwd || ''
            const mapping = findContextByWorktreePath(cwd)
            if (mapping) {
              handleHookEvent(mapping.contextId, 'agent', 'notification')
            }
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true }))
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'invalid json' }))
          }
        })
      } else {
        res.writeHead(404)
        res.end()
      }
    })

    // Listen on random available port
    server.listen(0, '127.0.0.1', () => {
      const addr = server!.address()
      if (addr && typeof addr === 'object') {
        serverPort = addr.port
        console.log(`Notification server listening on port ${serverPort}`)
        resolve(serverPort)
      } else {
        reject(new Error('Failed to get server address'))
      }
    })

    server.on('error', reject)
  })
}

export function stopNotificationServer() {
  if (server) {
    server.close()
    server = null
    serverPort = null
  }
}
