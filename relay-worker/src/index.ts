/**
 * Cloudflare Worker port of the relay backend.
 *
 * Architecture: a `Room` Durable Object is keyed by handle (idFromName). The
 * Worker is stateless — it routes /register and WebSocket upgrades into the
 * appropriate Room DO, which holds the desktop + phone sockets and forwards
 * encrypted frames between them. The receiver SPA is served from the assets
 * binding.
 *
 * One DO instance per active handle. Idle rooms cost nothing (hibernated).
 */

interface Env {
  ROOM: DurableObjectNamespace
  ASSETS: Fetcher
}

const HANDLE_RE = /^[a-z]+(-[a-z]+){2,}$/

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)

    if (url.pathname === '/health') {
      // The `rooms` field is the signal the receiver SPA uses to detect cloud
      // mode (vs LAN). Keep it present even though we can't cheaply count
      // active DOs from a stateless Worker.
      return Response.json({ ok: true, runtime: 'cloudflare-workers', rooms: 0 })
    }

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() })
    }

    if (req.method === 'POST' && url.pathname === '/register') {
      const body = (await req.json().catch(() => ({}))) as { handle?: string }
      const handle = (body.handle ?? '').toLowerCase().trim()
      if (!HANDLE_RE.test(handle)) {
        return jsonError('bad handle', 400)
      }
      const stub = env.ROOM.get(env.ROOM.idFromName(handle))
      const resp = await stub.fetch('https://room/register', { method: 'POST' })
      if (!resp.ok) return withCors(resp)
      const data = (await resp.json()) as { token: string }
      return withCors(Response.json({ handle, token: data.token }))
    }

    if (url.pathname === '/desktop' || url.pathname === '/phone') {
      const handle = (url.searchParams.get('handle') ?? '').toLowerCase().trim()
      if (!HANDLE_RE.test(handle)) return new Response('bad handle', { status: 400 })
      const stub = env.ROOM.get(env.ROOM.idFromName(handle))
      return stub.fetch(req)
    }

    // Static SPA fallback (handles / and any other path).
    return env.ASSETS.fetch(req)
  },
}

function corsHeaders(): HeadersInit {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  })
}

function withCors(r: Response): Response {
  const h = new Headers(r.headers)
  for (const [k, v] of Object.entries(corsHeaders())) h.set(k, v as string)
  return new Response(r.body, { status: r.status, headers: h })
}

// ---------------------------------------------------------------------------
// Durable Object: one instance per handle. Holds the desktop + phone sockets
// using the hibernatable WebSocket API so idle rooms cost nothing.
// ---------------------------------------------------------------------------

export class Room {
  state: DurableObjectState
  token: string | null = null

  constructor(state: DurableObjectState, _env: Env) {
    this.state = state
    state.blockConcurrencyWhile(async () => {
      this.token = (await state.storage.get<string>('token')) ?? null
    })
  }

  private getSocketByTag(tag: 'desktop' | 'phone'): WebSocket | null {
    const list = this.state.getWebSockets(tag)
    return list[0] ?? null
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)

    // Claim the room — only succeeds if not already registered.
    if (req.method === 'POST' && url.pathname === '/register') {
      if (this.token) {
        // Handle already taken. Caller retries with a fresh candidate.
        return new Response(JSON.stringify({ error: 'in use' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      const bytes = new Uint8Array(32)
      crypto.getRandomValues(bytes)
      const token = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
      await this.state.storage.put('token', token)
      this.token = token
      return Response.json({ token })
    }

    // WebSocket upgrades.
    if (req.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 400 })
    }

    if (url.pathname === '/desktop') {
      const t = url.searchParams.get('token')
      if (!this.token || t !== this.token) {
        return new Response('unauthorized', { status: 401 })
      }
      const existing = this.getSocketByTag('desktop')
      if (existing) {
        try { existing.close(4000, 'replaced') } catch {}
      }
      const pair = new WebSocketPair()
      this.state.acceptWebSocket(pair[1], ['desktop'])
      return new Response(null, { status: 101, webSocket: pair[0] })
    }

    if (url.pathname === '/phone') {
      const existing = this.getSocketByTag('phone')
      if (existing) {
        try { existing.close(4001, 'displaced') } catch {}
      }
      const pair = new WebSocketPair()
      const server = pair[1]
      this.state.acceptWebSocket(server, ['phone'])
      const desktop = this.getSocketByTag('desktop')
      if (!desktop) {
        try { server.send(JSON.stringify({ kind: 'peer-absent' })) } catch {}
      } else {
        try { desktop.send(JSON.stringify({ kind: 'peer-arrived' })) } catch {}
      }
      return new Response(null, { status: 101, webSocket: pair[0] })
    }

    return new Response('not found', { status: 404 })
  }

  // Hibernation-API message handler. Tags on the socket tell us which side
  // sent it; we forward to the other side.
  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    const tags = this.state.getTags(ws)
    const isDesktop = tags.includes('desktop')
    const peer = this.getSocketByTag(isDesktop ? 'phone' : 'desktop')
    if (!peer) return
    try { peer.send(message) } catch {}
  }

  webSocketClose(ws: WebSocket): void {
    const tags = this.state.getTags(ws)
    if (tags.includes('desktop')) {
      const phone = this.getSocketByTag('phone')
      if (phone) {
        try { phone.send(JSON.stringify({ kind: 'peer-gone' })) } catch {}
      }
    }
    try { ws.close() } catch {}
  }

  webSocketError(ws: WebSocket): void {
    this.webSocketClose(ws)
  }
}
