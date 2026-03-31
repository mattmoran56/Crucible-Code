import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { URL } from 'node:url'
import { app, BrowserWindow } from 'electron'
import { IPC } from '../../shared/constants'
import type { HookType } from '../../shared/types'
import { showNotification } from './notification.service'
import {
  isConnected as isSlackConnected,
  sendPermissionRequest,
  sendNotificationMessage,
} from './slack.service'

interface SessionMapping {
  sessionId: string
  sessionName: string
  projectId: string
  worktreePath: string
}

let server: http.Server | null = null
let serverPort: number | null = null
let mainWindow: BrowserWindow | null = null
const sessionMappings = new Map<string, SessionMapping>()

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

export function registerSessionMapping(mapping: SessionMapping) {
  // Normalize path: strip trailing slash for consistent matching
  const normalizedPath = mapping.worktreePath.replace(/\/+$/, '')
  sessionMappings.set(normalizedPath, mapping)
}

export function removeSessionMapping(worktreePath: string) {
  const normalizedPath = worktreePath.replace(/\/+$/, '')
  sessionMappings.delete(normalizedPath)
}

function findSessionByWorktreePath(cwd: string): SessionMapping | undefined {
  const normalizedCwd = cwd.replace(/\/+$/, '')
  // Direct match first
  if (sessionMappings.has(normalizedCwd)) {
    return sessionMappings.get(normalizedCwd)
  }
  // Check if cwd is a subdirectory of any worktree
  for (const [path, mapping] of sessionMappings) {
    if (normalizedCwd.startsWith(path + '/')) {
      return mapping
    }
  }
  return undefined
}

export function handleHookEvent(sessionId: string, sessionName: string, hookType: HookType) {
  if (!mainWindow) return

  // Send typed status event to the renderer
  mainWindow.webContents.send(IPC.NOTIFICATION_SESSION_STATUS, sessionId, hookType)

  // OS notifications only for attention and completed — not for running
  if (hookType === 'notification') {
    showNotification('Crucible Code', `Session "${sessionName}" needs your attention`)
  } else if (hookType === 'stop') {
    showNotification('Crucible Code', `Session "${sessionName}" is done`)
  }
}

// Keep legacy handler for fallback path (triggerForSession from renderer)
export function handleNotificationForSession(sessionId: string, sessionName: string) {
  handleHookEvent(sessionId, sessionName, 'notification')
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString() })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

export function startNotificationServer(window: BrowserWindow): Promise<number> {
  mainWindow = window

  return new Promise((resolve, reject) => {
    server = http.createServer(async (req, res) => {
      try {
        // ── PreToolUse permission endpoint (long-poll) ──────────────
        // The hook script POSTs here and blocks until Slack responds
        if (req.method === 'POST' && req.url?.startsWith('/hook/permission')) {
          const body = await readBody(req)
          const data = JSON.parse(body)
          const cwd = data.cwd || ''
          const session = findSessionByWorktreePath(cwd)

          if (!session || !isSlackConnected()) {
            // No session or no Slack — return "ask" so the normal prompt shows
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ decision: 'ask' }))
            return
          }

          // Send to Slack and wait for button click
          const requestId = randomUUID()
          const decision = await sendPermissionRequest({
            requestId,
            sessionId: session.sessionId,
            sessionName: session.sessionName,
            toolName: data.tool_name || 'Unknown',
            toolInput: data.tool_input || {},
          })

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ decision }))
          return
        }

        // ── Existing hook endpoint: POST /hook?type=prompt|notification|stop
        if (req.method === 'POST' && req.url?.startsWith('/hook')) {
          const body = await readBody(req)
          const data = JSON.parse(body)
          const cwd = data.cwd || ''
          const session = findSessionByWorktreePath(cwd)

          if (session) {
            const url = new URL(req.url!, `http://127.0.0.1`)
            const hookType = (url.searchParams.get('type') || 'notification') as HookType

            handleHookEvent(session.sessionId, session.sessionName, hookType)

            // Forward Notification hook data to Slack (informational)
            if (hookType === 'notification' && isSlackConnected() && data.message) {
              sendNotificationMessage(
                session.sessionName,
                data.message,
                data.title
              ).catch((err) => console.error('Slack notification failed:', err))
            }
          }

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
          return
        }

        // ── Legacy endpoint
        if (req.method === 'POST' && req.url === '/notification') {
          const body = await readBody(req)
          const data = JSON.parse(body)
          const cwd = data.cwd || ''
          const session = findSessionByWorktreePath(cwd)

          if (session) {
            handleHookEvent(session.sessionId, session.sessionName, 'notification')
          }

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
          return
        }

        res.writeHead(404)
        res.end()
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'invalid request' }))
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
