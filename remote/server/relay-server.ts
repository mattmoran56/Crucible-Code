import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { URL } from 'node:url'
import { networkInterfaces } from 'node:os'
import { WebSocketServer, type WebSocket } from 'ws'
import Store from 'electron-store'
import { REMOTE_DEFAULT_PORT } from '../protocol/channels'
import { generatePairingCode, consumePairingCode, currentPairingCode } from './pairing'
import { issueToken, verifyToken, listDevices, revokeAll } from './auth'
import { attachBridge } from './bridge'

const settingsStore = new Store<{ remoteEnabled: boolean; remotePort: number }>({
  name: 'remote-settings',
  defaults: { remoteEnabled: false, remotePort: REMOTE_DEFAULT_PORT },
})

let server: http.Server | null = null
let wss: WebSocketServer | null = null
const detachFns = new Set<() => void>()

function receiverDistDir(): string {
  // Walk up from the bundled main file (out/main in dev, similar in prod)
  // until we find a sibling `remote/receiver/dist`.
  const candidates = [
    path.resolve(__dirname, '../../remote/receiver/dist'),
    path.resolve(__dirname, '../../../remote/receiver/dist'),
    path.resolve(process.cwd(), 'remote/receiver/dist'),
  ]
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'index.html'))) return c
  }
  return candidates[0]
}

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://x')
  let rel = url.pathname === '/' ? '/index.html' : url.pathname
  rel = rel.replace(/\.\./g, '')
  const full = path.join(receiverDistDir(), rel)
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    res.statusCode = 404
    res.end('not found')
    return
  }
  const ext = path.extname(full)
  const type =
    ext === '.html' ? 'text/html' :
    ext === '.js' ? 'application/javascript' :
    ext === '.css' ? 'text/css' :
    ext === '.svg' ? 'image/svg+xml' :
    ext === '.json' ? 'application/json' :
    'application/octet-stream'
  res.setHeader('Content-Type', type)
  fs.createReadStream(full).pipe(res)
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

function setCors(res: http.ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function handleHttp(req: http.IncomingMessage, res: http.ServerResponse): void {
  setCors(res)
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }
  const url = new URL(req.url ?? '/', 'http://x')
  if (req.method === 'POST' && url.pathname === '/pair') {
    readBody(req).then((body) => {
      let code = ''
      let label = 'unknown'
      try {
        const parsed = JSON.parse(body) as { code?: string; label?: string }
        code = parsed.code ?? ''
        label = parsed.label ?? 'unknown'
      } catch {
        res.statusCode = 400
        res.end('bad json')
        return
      }
      if (!consumePairingCode(code)) {
        res.statusCode = 401
        res.end(JSON.stringify({ error: 'invalid or expired code' }))
        return
      }
      const token = issueToken(label)
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ token }))
    })
    return
  }
  if (req.method === 'GET' && url.pathname === '/health') {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: true, hasCode: currentPairingCode() !== null }))
    return
  }
  if (req.method === 'GET' && url.pathname.startsWith('/assets/')) {
    serveStatic(req, res)
    return
  }
  if (req.method === 'GET' && (url.pathname === '/' || !path.extname(url.pathname))) {
    // SPA: any non-asset GET returns index.html
    req.url = '/'
    serveStatic(req, res)
    return
  }
  serveStatic(req, res)
}

export function isRemoteEnabled(): boolean {
  return settingsStore.get('remoteEnabled', false)
}

export function setRemoteEnabled(enabled: boolean): void {
  settingsStore.set('remoteEnabled', enabled)
}

export function getRelayPort(): number {
  return settingsStore.get('remotePort', REMOTE_DEFAULT_PORT)
}

export function setRelayPort(port: number): void {
  settingsStore.set('remotePort', port)
}

export function getLanUrls(): string[] {
  const port = getRelayPort()
  const urls: string[] = []
  const nets = networkInterfaces()
  for (const list of Object.values(nets)) {
    if (!list) continue
    for (const n of list) {
      if (n.family === 'IPv4' && !n.internal) {
        urls.push(`http://${n.address}:${port}/`)
      }
    }
  }
  return urls
}

export function isRelayRunning(): boolean {
  return server !== null
}

export async function startRelayServer(): Promise<void> {
  if (server) return
  const port = getRelayPort()
  server = http.createServer(handleHttp)
  wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://x')
    if (url.pathname !== '/ws') {
      socket.destroy()
      return
    }
    const token = url.searchParams.get('token')
    if (!verifyToken(token)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }
    wss!.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      const detach = attachBridge(ws)
      detachFns.add(detach)
      ws.on('close', () => {
        detach()
        detachFns.delete(detach)
      })
    })
  })

  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject)
    server!.listen(port, '0.0.0.0', () => resolve())
  })
  // Generate a fresh pairing code on each start.
  generatePairingCode()
  // eslint-disable-next-line no-console
  console.log(`[remote] relay listening on 0.0.0.0:${port}`)
}

export async function startRelayIfEnabled(): Promise<void> {
  if (!isRemoteEnabled()) return
  await startRelayServer()
}

export function stopRelayServer(): void {
  for (const detach of detachFns) detach()
  detachFns.clear()
  if (wss) {
    wss.clients.forEach((c) => c.close())
    wss.close()
    wss = null
  }
  if (server) {
    server.close()
    server = null
  }
  revokeAll()
}

export interface RemoteStatus {
  enabled: boolean
  running: boolean
  port: number
  urls: string[]
  pairingCode: string | null
  devices: { token: string; label: string; createdAt: number }[]
}

export function getRemoteStatus(): RemoteStatus {
  return {
    enabled: isRemoteEnabled(),
    running: isRelayRunning(),
    port: getRelayPort(),
    urls: getLanUrls(),
    pairingCode: currentPairingCode(),
    devices: listDevices(),
  }
}

export function regeneratePairingCode(): string {
  return generatePairingCode()
}
