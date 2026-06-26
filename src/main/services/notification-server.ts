import http from 'node:http'
import { EventEmitter } from 'node:events'
import { URL } from 'node:url'
import { app, BrowserWindow } from 'electron'
import { IPC } from '../../shared/constants'
import type { HookType, ContextKind } from '../../shared/types'
import { showNotification } from './notification.service'
import { emitToRenderer } from './event-bus'

/**
 * Fired for every routed hook event (prompt | notification | stop) as soon as
 * it is handled, BEFORE any OS-notification filtering. Lets in-process
 * orchestrators (e.g. the foreground review loop) await a specific terminal's
 * Stop event by (contextId, tabId) instead of parsing headless output.
 */
export interface HookEvent {
  contextId: string
  tabId: string
  hookType: HookType
}

const hookEvents = new EventEmitter()
// Many phase terminals can be in flight at once; lift the default 10-listener
// cap so we don't print spurious leak warnings during a multi-round loop.
hookEvents.setMaxListeners(0)

/** Subscribe to routed hook events. Returns an unsubscribe function. */
export function onHookEvent(listener: (evt: HookEvent) => void): () => void {
  hookEvents.on('hook', listener)
  return () => hookEvents.off('hook', listener)
}

/**
 * Fields captured from an intercepted `gh pr create` (see gh-shim). title/body
 * arrive base64-encoded on the wire; they're decoded before reaching the fn.
 */
export interface LocalPRCaptureArgs {
  contextId: string
  projectId: string
  worktreePath: string
  /** Which gh subcommand was intercepted. */
  action: 'create' | 'edit' | 'ready' | 'view'
  fields: {
    title: string
    body: string
    /** Whether --title / --body(-file) were actually passed (for edit). */
    haveTitle?: boolean
    haveBody?: boolean
    base?: string
    head?: string
    sha?: string
    draft?: boolean
    /** Comma-separated field list from `gh pr view --json`. */
    json?: string
  }
}

/**
 * Handles a captured gh command against the local PR record. Returns the fake
 * PR ref (create/edit), nothing meaningful (ready), or base64 view output
 * (view) the shim prints back to the agent.
 */
export type LocalPRCaptureFn = (
  args: LocalPRCaptureArgs
) => Promise<{ number?: number; url?: string; view_b64?: string }>

let localPRCaptureFn: LocalPRCaptureFn | null = null

/** Register the handler that turns a captured `gh pr create` into a local PR. */
export function setLocalPRCapture(fn: LocalPRCaptureFn | null): void {
  localPRCaptureFn = fn
}

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
  // Fan out to in-process subscribers first — this must fire even if the
  // main window is gone, so the review loop can still advance phases.
  hookEvents.emit('hook', { contextId, tabId, hookType })

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
        // Collect raw Buffer chunks and decode once at the end. The previous
        // `body += chunk.toString()` was O(n²) for large payloads and also
        // risked splitting multi-byte UTF-8 sequences across chunks.
        const chunks: Buffer[] = []
        req.on('data', (chunk: Buffer) => {
          chunks.push(chunk)
        })
        req.on('end', () => {
          try {
            const body = Buffer.concat(chunks).toString('utf8')
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
      } else if (req.method === 'POST' && req.url?.startsWith('/local-pr')) {
        // Captured `gh pr create` from the gh shim. Resolve the context (so we
        // know which project/worktree this belongs to), hand off to the
        // registered capture fn, and echo back the allocated fake PR ref so the
        // shim can print a plausible PR URL to the agent.
        const chunks: Buffer[] = []
        req.on('data', (chunk: Buffer) => {
          chunks.push(chunk)
        })
        req.on('end', () => {
          void (async () => {
            try {
              const body = Buffer.concat(chunks).toString('utf8')
              const data = JSON.parse(body) as {
                action?: 'create' | 'edit' | 'ready' | 'view'
                title_b64?: string
                body_b64?: string
                have_title?: boolean
                have_body?: boolean
                base?: string
                head?: string
                sha?: string
                draft?: boolean
                json?: string
                cwd?: string
              }
              const url = new URL(req.url!, `http://127.0.0.1`)
              const contextParam = url.searchParams.get('context') || ''

              let mapping = contextParam ? contextMappings.get(contextParam) : undefined
              if (!mapping) mapping = findContextByWorktreePath(data.cwd || '')

              if (!mapping || !localPRCaptureFn) {
                res.writeHead(503, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ error: 'local PR capture not available' }))
                return
              }

              const decode = (b64?: string): string =>
                b64 ? Buffer.from(b64, 'base64').toString('utf8') : ''

              const result = await localPRCaptureFn({
                contextId: mapping.contextId,
                projectId: mapping.projectId,
                worktreePath: mapping.worktreePath,
                action: data.action ?? 'create',
                fields: {
                  title: decode(data.title_b64),
                  body: decode(data.body_b64),
                  haveTitle: data.have_title,
                  haveBody: data.have_body,
                  base: data.base,
                  head: data.head,
                  sha: data.sha,
                  draft: data.draft,
                  json: data.json,
                },
              })

              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: true, ...result }))
            } catch (err) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'capture failed' }))
            }
          })()
        })
      } else if (req.method === 'POST' && req.url === '/notification') {
        // Legacy endpoint — treat as notification type, route by cwd
        const chunks: Buffer[] = []
        req.on('data', (chunk: Buffer) => {
          chunks.push(chunk)
        })
        req.on('end', () => {
          try {
            const body = Buffer.concat(chunks).toString('utf8')
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
