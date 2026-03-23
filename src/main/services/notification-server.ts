import http from 'node:http'
import { BrowserWindow } from 'electron'
import { IPC } from '../../shared/constants'
import { showNotification } from './notification.service'

interface ActiveContext {
  projectId: string | null
  sessionId: string | null
}

interface SessionMapping {
  sessionId: string
  sessionName: string
  projectId: string
  worktreePath: string
}

let server: http.Server | null = null
let serverPort: number | null = null
let mainWindow: BrowserWindow | null = null
let windowFocused = true
let activeContext: ActiveContext = { projectId: null, sessionId: null }
const sessionMappings = new Map<string, SessionMapping>()

export function getNotificationServerPort(): number | null {
  return serverPort
}

export function setActiveContext(context: ActiveContext) {
  activeContext = context
}

export function setWindowFocused(focused: boolean) {
  windowFocused = focused
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

function shouldSuppressNotification(sessionId: string): boolean {
  return (
    windowFocused &&
    activeContext.sessionId === sessionId
  )
}

export function handleNotificationForSession(sessionId: string, sessionName: string) {
  if (!mainWindow) return

  // Always send the in-app indicator to the renderer
  mainWindow.webContents.send(IPC.NOTIFICATION_HOOK_EVENT, sessionId)

  // Only show OS notification if user isn't already looking at this session
  if (!shouldSuppressNotification(sessionId)) {
    showNotification('CodeCrucible', `Session "${sessionName}" needs your attention`)
  }
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
