import http from 'node:http'
import { app, BrowserWindow } from 'electron'
import { IPC } from '../../shared/constants'
import { showNotification } from './notification.service'

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

export function handleNotificationForSession(sessionId: string, sessionName: string) {
  if (!mainWindow) return

  // Always send the in-app indicator to the renderer
  mainWindow.webContents.send(IPC.NOTIFICATION_HOOK_EVENT, sessionId)

  // Always show OS notification regardless of which session/project is active
  showNotification('Crucible Code', `Session "${sessionName}" needs your attention`)
}

export function startNotificationServer(window: BrowserWindow): Promise<number> {
  mainWindow = window

  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/notification') {
        let body = ''
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString()
        })
        req.on('end', () => {
          try {
            const data = JSON.parse(body)
            const cwd = data.cwd || ''
            const session = findSessionByWorktreePath(cwd)

            if (session) {
              handleNotificationForSession(session.sessionId, session.sessionName)
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
