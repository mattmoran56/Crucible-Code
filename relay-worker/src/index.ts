/**
 * Cloudflare Worker port of the relay backend.
 *
 * Architecture: a `Room` Durable Object is keyed by handle (idFromName). The
 * Worker is stateless — it routes /register, /unregister, and WebSocket
 * upgrades into the appropriate Room DO, which holds the desktop + phone
 * sockets and forwards encrypted frames between them. The receiver SPA is
 * served from the assets binding.
 *
 * Security layers applied at the relay level (in addition to the end-to-end
 * libsodium crypto in the IPC payload):
 *   1. /phone requires a ticket that the desktop deposits via /set-phone-ticket
 *      after /register. Wrong / missing / unknown all return identical 401
 *      responses so the handle namespace can't be enumerated.
 *   2. Each Room DO holds a 30-day alarm that wipes the token + ticket if no
 *      desktop has connected. Prevents permanent handle squatting.
 *   3. /unregister explicitly drops the room and KV entry.
 *   4. /register accepts an optional `currentToken` for proof-of-possession
 *      rotation. Without it, an existing handle returns 409 (as today).
 *   5. Per-IP token-bucket rate-limit on /register, enforced from a single
 *      `RateLimit` DO addressed by idFromName("register").
 *   6. KV registry (`HANDLE_REGISTRY`) gates DO spawning: the Worker checks
 *      the handle exists in KV before routing /phone or /desktop. Unknown
 *      handles return the same 401 as a bad ticket.
 */

interface Env {
  ROOM: DurableObjectNamespace
  RATE_LIMIT: DurableObjectNamespace
  HANDLE_REGISTRY: KVNamespace
  ASSETS: Fetcher
}

const HANDLE_RE = /^[a-z]+(-[a-z]+){2,}$/
const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000
const KV_TTL_S = Math.floor(TOKEN_TTL_MS / 1000) + 86400 // a day of slack

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)

    if (url.pathname === '/health') {
      return Response.json({ ok: true, runtime: 'cloudflare-workers', rooms: 0 })
    }

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() })
    }

    if (req.method === 'POST' && url.pathname === '/register') {
      return handleRegister(req, env)
    }

    if (req.method === 'POST' && url.pathname === '/unregister') {
      return handleUnregister(req, env)
    }

    if (req.method === 'POST' && url.pathname === '/set-phone-ticket') {
      return handleSetPhoneTicket(req, env)
    }

    if (url.pathname === '/desktop' || url.pathname === '/phone') {
      return handleUpgrade(req, env, url)
    }

    // Static SPA fallback (handles / and any other path).
    return env.ASSETS.fetch(req)
  },
}

// ---- /register --------------------------------------------------------------

async function handleRegister(req: Request, env: Env): Promise<Response> {
  // Per-IP rate limit via a single fixed RateLimit DO.
  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown'
  const limiter = env.RATE_LIMIT.get(env.RATE_LIMIT.idFromName('register'))
  const limitResp = await limiter.fetch('https://rl/take', {
    method: 'POST',
    body: JSON.stringify({ ip }),
  })
  if (limitResp.status === 429) {
    return withCors(new Response(JSON.stringify({ error: 'rate limited' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    }))
  }

  const body = (await req.json().catch(() => ({}))) as {
    handle?: string
    currentToken?: string
  }
  const handle = (body.handle ?? '').toLowerCase().trim()
  if (!HANDLE_RE.test(handle)) {
    return jsonError('bad handle', 400)
  }

  const stub = env.ROOM.get(env.ROOM.idFromName(handle))
  const doReq = new Request('https://room/register', {
    method: 'POST',
    body: JSON.stringify({ currentToken: body.currentToken }),
    headers: { 'Content-Type': 'application/json' },
  })
  const resp = await stub.fetch(doReq)
  if (!resp.ok) return withCors(resp)
  const data = (await resp.json()) as { token: string }

  // Write existence marker into KV so /phone and /desktop won't spawn a fresh
  // DO for unknown handles.
  await env.HANDLE_REGISTRY.put(handle, '1', { expirationTtl: KV_TTL_S })

  return withCors(Response.json({ handle, token: data.token }))
}

// ---- /unregister ------------------------------------------------------------

async function handleUnregister(req: Request, env: Env): Promise<Response> {
  const { handle, token } = await readHandleToken(req)
  if (!HANDLE_RE.test(handle) || !token) {
    return jsonError('bad request', 400)
  }
  const stub = env.ROOM.get(env.ROOM.idFromName(handle))
  const doReq = new Request('https://room/unregister', {
    method: 'POST',
    body: JSON.stringify({ token }),
    headers: { 'Content-Type': 'application/json' },
  })
  const resp = await stub.fetch(doReq)
  if (resp.ok) {
    await env.HANDLE_REGISTRY.delete(handle)
  }
  return withCors(resp)
}

// ---- /set-phone-ticket ------------------------------------------------------

async function handleSetPhoneTicket(req: Request, env: Env): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as {
    handle?: string
    token?: string
    ticket?: string
  }
  const handle = (body.handle ?? '').toLowerCase().trim()
  if (!HANDLE_RE.test(handle) || !body.token || !body.ticket) {
    return jsonError('bad request', 400)
  }
  // Gate via KV first so an unknown handle doesn't even spawn a DO.
  const exists = await env.HANDLE_REGISTRY.get(handle)
  if (!exists) return jsonError('unauthorized', 401)
  const stub = env.ROOM.get(env.ROOM.idFromName(handle))
  const doReq = new Request('https://room/set-phone-ticket', {
    method: 'POST',
    body: JSON.stringify({ token: body.token, ticket: body.ticket }),
    headers: { 'Content-Type': 'application/json' },
  })
  return withCors(await stub.fetch(doReq))
}

// ---- WS upgrades ------------------------------------------------------------

async function handleUpgrade(req: Request, env: Env, url: URL): Promise<Response> {
  const handle = (url.searchParams.get('handle') ?? '').toLowerCase().trim()
  if (!HANDLE_RE.test(handle)) return new Response('bad handle', { status: 400 })

  // KV-gate: no DO spawn for unknown handles. Same 401 as /phone bad-ticket
  // below so neither side can enumerate the namespace.
  const exists = await env.HANDLE_REGISTRY.get(handle)
  if (!exists) {
    if (url.pathname === '/phone') return unauthorizedWs()
    return new Response('unauthorized', { status: 401 })
  }

  const stub = env.ROOM.get(env.ROOM.idFromName(handle))
  return stub.fetch(req)
}

// Single canonical 401 response for /phone — keep body/headers identical
// across all reject paths (unknown handle, no ticket, wrong ticket, no
// ticket configured) so phones can't tell the cases apart.
function unauthorizedWs(): Response {
  return new Response('unauthorized', { status: 401 })
}

// ---- Helpers ----------------------------------------------------------------

async function readHandleToken(req: Request): Promise<{ handle: string; token: string }> {
  const auth = req.headers.get('Authorization')
  const bearer = auth?.match(/^Bearer\s+([0-9a-f]+)$/i)?.[1]
  const body = (await req.json().catch(() => ({}))) as { handle?: string; token?: string }
  return {
    handle: (body.handle ?? '').toLowerCase().trim(),
    token: bearer ?? body.token ?? '',
  }
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

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
}

// ---------------------------------------------------------------------------
// RateLimit DO — single instance, token bucket per IP. Lives in memory only;
// loss on eviction just means a fresh burst, which is fine.
// ---------------------------------------------------------------------------

const RL_RATE = 5 // tokens per minute
const RL_BURST = 5

export class RateLimit {
  buckets = new Map<string, { tokens: number; lastRefill: number }>()

  // unused but DO contract requires the constructor signature
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_state: DurableObjectState, _env: Env) {}

  async fetch(req: Request): Promise<Response> {
    const { ip } = (await req.json()) as { ip: string }
    const now = Date.now()
    const b = this.buckets.get(ip) ?? { tokens: RL_BURST, lastRefill: now }
    const elapsedMin = (now - b.lastRefill) / 60_000
    b.tokens = Math.min(RL_BURST, b.tokens + elapsedMin * RL_RATE)
    b.lastRefill = now
    if (b.tokens < 1) {
      this.buckets.set(ip, b)
      return new Response('rate limited', { status: 429 })
    }
    b.tokens -= 1
    this.buckets.set(ip, b)
    return new Response('ok')
  }
}

// ---------------------------------------------------------------------------
// Room DO — one instance per handle. Holds the desktop + phone sockets using
// the hibernatable WebSocket API so idle rooms cost nothing.
// ---------------------------------------------------------------------------

export class Room {
  state: DurableObjectState
  env: Env
  token: string | null = null
  phoneTicket: string | null = null
  lastDesktopConnect: number = 0

  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.env = env
    state.blockConcurrencyWhile(async () => {
      this.token = (await state.storage.get<string>('token')) ?? null
      this.phoneTicket = (await state.storage.get<string>('phoneTicket')) ?? null
      this.lastDesktopConnect = (await state.storage.get<number>('lastDesktopConnect')) ?? 0
    })
  }

  private getSocketByTag(tag: 'desktop' | 'phone'): WebSocket | null {
    const list = this.state.getWebSockets(tag)
    return list[0] ?? null
  }

  private async scheduleCleanupAlarm(): Promise<void> {
    await this.state.storage.setAlarm(Date.now() + TOKEN_TTL_MS)
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)

    if (req.method === 'POST' && url.pathname === '/register') {
      const body = (await req.json().catch(() => ({}))) as { currentToken?: string }
      if (this.token) {
        // Rotation path — must present current token.
        if (!body.currentToken || !constantTimeEqual(body.currentToken, this.token)) {
          return new Response(JSON.stringify({ error: 'in use' }), {
            status: 409,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        // Rotate both token AND phone ticket — force phone to re-pair.
        this.token = randomHex(32)
        this.phoneTicket = null
        await this.state.storage.put('token', this.token)
        await this.state.storage.delete('phoneTicket')
      } else {
        this.token = randomHex(32)
        await this.state.storage.put('token', this.token)
      }
      await this.scheduleCleanupAlarm()
      return Response.json({ token: this.token })
    }

    if (req.method === 'POST' && url.pathname === '/unregister') {
      const { token } = (await req.json().catch(() => ({}))) as { token?: string }
      if (!this.token || !token || !constantTimeEqual(token, this.token)) {
        return new Response('unauthorized', { status: 401 })
      }
      await this.purge()
      return new Response('ok')
    }

    if (req.method === 'POST' && url.pathname === '/set-phone-ticket') {
      const { token, ticket } = (await req.json().catch(() => ({}))) as {
        token?: string
        ticket?: string
      }
      if (!this.token || !token || !constantTimeEqual(token, this.token)) {
        return new Response('unauthorized', { status: 401 })
      }
      if (!ticket || ticket.length < 8) {
        return jsonError('bad ticket', 400)
      }
      this.phoneTicket = ticket
      await this.state.storage.put('phoneTicket', ticket)
      return new Response('ok')
    }

    // WebSocket upgrades.
    if (req.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 400 })
    }

    if (url.pathname === '/desktop') {
      const t = url.searchParams.get('token') ?? ''
      if (!this.token || !constantTimeEqual(t, this.token)) {
        return new Response('unauthorized', { status: 401 })
      }
      const existing = this.getSocketByTag('desktop')
      if (existing) {
        try { existing.close(4000, 'replaced') } catch {}
      }
      const pair = new WebSocketPair()
      this.state.acceptWebSocket(pair[1], ['desktop'])
      this.lastDesktopConnect = Date.now()
      await this.state.storage.put('lastDesktopConnect', this.lastDesktopConnect)
      await this.scheduleCleanupAlarm()
      return new Response(null, { status: 101, webSocket: pair[0] })
    }

    if (url.pathname === '/phone') {
      const ticket = url.searchParams.get('ticket') ?? ''
      // All four reject reasons map to the same 401 response — no oracle.
      if (!this.phoneTicket || !ticket || !constantTimeEqual(ticket, this.phoneTicket)) {
        return unauthorizedWs()
      }
      const existing = this.getSocketByTag('phone')
      if (existing) {
        try { existing.close(4001, 'displaced') } catch {}
      }
      const pair = new WebSocketPair()
      const server = pair[1]
      this.state.acceptWebSocket(server, ['phone'])
      const desktop = this.getSocketByTag('desktop')
      // peer-absent is only sent *after* the ticket passed, so it doesn't leak
      // handle existence to a probe.
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

  // Alarm fires TOKEN_TTL_MS after the last desktop connect (or /register).
  // If no fresh activity has happened, wipe the room so handles don't
  // permanently squat.
  async alarm(): Promise<void> {
    const idleFor = Date.now() - this.lastDesktopConnect
    if (idleFor < TOKEN_TTL_MS) {
      // Re-schedule for the remaining window — this catches the case where
      // alarm fires after a fresh desktop connect bumped lastDesktopConnect.
      await this.state.storage.setAlarm(this.lastDesktopConnect + TOKEN_TTL_MS)
      return
    }
    await this.purge()
  }

  private async purge(): Promise<void> {
    const desktop = this.getSocketByTag('desktop')
    if (desktop) try { desktop.close(4002, 'expired') } catch {}
    const phone = this.getSocketByTag('phone')
    if (phone) try { phone.close(4002, 'expired') } catch {}
    await this.state.storage.deleteAll()
    await this.state.storage.deleteAlarm()
    this.token = null
    this.phoneTicket = null
    this.lastDesktopConnect = 0
  }
}
