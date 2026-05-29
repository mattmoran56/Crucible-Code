import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { URL, fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { WebSocketServer, type WebSocket } from 'ws'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const PORT = Number(process.env.PORT ?? 9000)
const HOST = process.env.HOST ?? '0.0.0.0'

// In-memory room map. Restart drops all sessions — by design.
interface Room {
  desktop: WebSocket | null
  desktopToken: string
  // v1: at most one phone at a time. A second `/phone` connection displaces
  // the first (newer wins). Multi-phone support would require either per-frame
  // routing or per-phone keys negotiated client-side; out of scope for v1.
  phone: WebSocket | null
}
const rooms = new Map<string, Room>()

// Per-IP rate limiting on /register: token bucket.
const registerBuckets = new Map<string, { tokens: number; lastRefill: number }>()
const REGISTER_RATE = 5 // tokens per minute
const REGISTER_BURST = 5

function rateLimit(ip: string): boolean {
  const now = Date.now()
  const b = registerBuckets.get(ip) ?? { tokens: REGISTER_BURST, lastRefill: now }
  const elapsedMin = (now - b.lastRefill) / 60_000
  b.tokens = Math.min(REGISTER_BURST, b.tokens + elapsedMin * REGISTER_RATE)
  b.lastRefill = now
  if (b.tokens < 1) {
    registerBuckets.set(ip, b)
    return false
  }
  b.tokens -= 1
  registerBuckets.set(ip, b)
  return true
}

function clientIp(req: http.IncomingMessage): string {
  const fwd = req.headers['x-forwarded-for']
  if (typeof fwd === 'string') return fwd.split(',')[0]!.trim()
  return req.socket.remoteAddress ?? 'unknown'
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

function setCors(res: http.ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

function staticDir(): string {
  // Receiver SPA build, copied/mounted into relay-backend/public at deploy time.
  return path.resolve(__dirname, '../public')
}

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://x')
  let rel = url.pathname === '/' ? '/index.html' : url.pathname
  rel = rel.replace(/\.\./g, '')
  const full = path.join(staticDir(), rel)
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    // SPA fallback
    const idx = path.join(staticDir(), 'index.html')
    if (fs.existsSync(idx)) {
      res.setHeader('Content-Type', 'text/html')
      res.setHeader('Cache-Control', 'no-store, must-revalidate')
      fs.createReadStream(idx).pipe(res)
      return
    }
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
    ext === '.png' ? 'image/png' :
    'application/octet-stream'
  res.setHeader('Content-Type', type)
  if (rel === '/index.html') {
    res.setHeader('Cache-Control', 'no-store, must-revalidate')
  } else {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  }
  fs.createReadStream(full).pipe(res)
}

function handleHttp(req: http.IncomingMessage, res: http.ServerResponse): void {
  setCors(res)
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }
  const url = new URL(req.url ?? '/', 'http://x')

  if (req.method === 'GET' && url.pathname === '/health') {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }))
    return
  }

  if (req.method === 'POST' && url.pathname === '/register') {
    const ip = clientIp(req)
    if (!rateLimit(ip)) {
      res.statusCode = 429
      res.end(JSON.stringify({ error: 'rate limited' }))
      return
    }
    readBody(req)
      .then((body) => {
        let handle = ''
        try {
          const parsed = JSON.parse(body) as { handle?: string }
          handle = (parsed.handle ?? '').toLowerCase().trim()
        } catch {
          res.statusCode = 400
          res.end(JSON.stringify({ error: 'bad json' }))
          return
        }
        if (!/^[a-z]+(-[a-z]+){2,}$/.test(handle)) {
          res.statusCode = 400
          res.end(JSON.stringify({ error: 'bad handle' }))
          return
        }
        const existing = rooms.get(handle)
        if (existing && existing.desktop) {
          // Handle is currently held by a connected desktop with a different token.
          res.statusCode = 409
          res.end(JSON.stringify({ error: 'handle in use' }))
          return
        }
        const token = randomBytes(32).toString('hex')
        rooms.set(handle, {
          desktop: null,
          desktopToken: token,
          phone: existing?.phone ?? null,
        })
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ handle, token }))
      })
      .catch(() => {
        res.statusCode = 500
        res.end()
      })
    return
  }

  serveStatic(req, res)
}

const server = http.createServer(handleHttp)
const wss = new WebSocketServer({ noServer: true })

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://x')
  const handle = (url.searchParams.get('handle') ?? '').toLowerCase().trim()
  if (!handle) {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
    socket.destroy()
    return
  }

  if (url.pathname === '/desktop') {
    const token = url.searchParams.get('token') ?? ''
    const room = rooms.get(handle)
    if (!room || room.desktopToken !== token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }
    if (room.desktop) {
      // Replace stale desktop connection.
      try { room.desktop.close(4000, 'replaced') } catch {}
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      room.desktop = ws
      // eslint-disable-next-line no-console
      console.log(`[relay] desktop joined: ${handle}`)
      ws.on('message', (data, isBinary) => {
        const phone = room.phone
        if (phone && phone.readyState === phone.OPEN) {
          try { phone.send(data, { binary: isBinary }) } catch {}
        }
      })
      ws.on('close', () => {
        if (room.desktop === ws) room.desktop = null
        const phone = room.phone
        if (phone && phone.readyState === phone.OPEN) {
          try { phone.send(JSON.stringify({ kind: 'peer-gone' })) } catch {}
        }
        // eslint-disable-next-line no-console
        console.log(`[relay] desktop left: ${handle}`)
      })
    })
    return
  }

  if (url.pathname === '/phone') {
    const room = rooms.get(handle)
    if (!room) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const prev = room.phone
      if (prev && prev !== ws) {
        try { prev.close(4001, 'displaced') } catch {}
      }
      room.phone = ws
      // eslint-disable-next-line no-console
      console.log(`[relay] phone joined: ${handle}`)
      if (!room.desktop) {
        try { ws.send(JSON.stringify({ kind: 'peer-absent' })) } catch {}
      } else {
        // Tell the desktop a fresh phone arrived so it can drop any stale
        // crypto state from a prior session and wait for a new `hello`.
        try { room.desktop.send(JSON.stringify({ kind: 'peer-arrived' })) } catch {}
      }
      ws.on('message', (data, isBinary) => {
        if (room.desktop && room.desktop.readyState === room.desktop.OPEN) {
          try { room.desktop.send(data, { binary: isBinary }) } catch {}
        }
      })
      ws.on('close', () => {
        if (room.phone === ws) room.phone = null
        // eslint-disable-next-line no-console
        console.log(`[relay] phone left: ${handle}`)
      })
    })
    return
  }

  socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
  socket.destroy()
})

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`[relay] listening on ${HOST}:${PORT}`)
})
