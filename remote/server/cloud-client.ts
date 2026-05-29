import { randomBytes } from 'node:crypto'
import WebSocket from 'ws'
import {
  generateKeypair,
  deriveSharedKey,
  seal,
  open,
  safetyNumber,
  b64encode,
  b64decode,
} from '../protocol/e2e'
import type { CloudEnvelope, CloudHello, CloudData, CloudInner } from '../protocol/cloud'
import { consumePairingCode, currentPairingCode } from './pairing'
import { issueToken, verifyToken } from './auth'
import {
  getCurrentHandle,
  getCurrentToken,
  setRegistered,
  generateCandidateHandle,
  clearHandle,
  getPhoneTicket,
  setPhoneTicket,
  getLastRegisteredAt,
  touchLastRegisteredAt,
} from './handle'
import { attachBridgeToTransport, type Transport } from './bridge'
import { awaitApproval } from './approval'
import Store from 'electron-store'

const settingsStore = new Store<{ cloudEnabled: boolean }>({
  name: 'remote-cloud-flags',
  defaults: { cloudEnabled: false },
})

function relayHttpUrl(): string {
  return process.env.RELAY_BACKEND_URL ?? 'https://relay.codecrucible.app'
}

function relayWsUrl(): string {
  const http = relayHttpUrl()
  return http.replace(/^http/i, 'ws')
}

// ---- Outer state -----------------------------------------------------------

let ws: WebSocket | null = null
let reconnectTimer: NodeJS.Timeout | null = null
let backoffMs = 1000
let stopped = true
let detachBridge: (() => void) | null = null
let lastSafetyNumber: string | null = null
let connected = false
let onStatusChange: (() => void) | null = null

// Per-session key state. Replaced on every fresh `peer-arrived` from the relay.
interface Session {
  sharedKey: Uint8Array | null
  myPriv: Uint8Array
  myPub: Uint8Array
  authed: boolean
}
let session: Session | null = null

// ---- Public API ------------------------------------------------------------

export function isCloudEnabled(): boolean {
  return settingsStore.get('cloudEnabled', false)
}

export function setCloudEnabled(enabled: boolean): void {
  settingsStore.set('cloudEnabled', enabled)
}

export function getCloudHandle(): string | null {
  return getCurrentHandle()
}

export function getCloudPhoneTicket(): string | null {
  return getPhoneTicket()
}

export function getCloudConnected(): boolean {
  return connected
}

export function getCloudSafetyNumber(): string | null {
  return lastSafetyNumber
}

export function setCloudStatusListener(cb: () => void): void {
  onStatusChange = cb
}

const ROTATE_AFTER_MS = 7 * 24 * 3600 * 1000

export async function startCloudClient(): Promise<void> {
  if (!stopped) return
  stopped = false
  await maybeRotateOnStartup()
  await ensureRegistered()
  scheduleConnect(0)
}

async function maybeRotateOnStartup(): Promise<void> {
  const handle = getCurrentHandle()
  const token = getCurrentToken()
  if (!handle || !token) return
  const last = getLastRegisteredAt() ?? 0
  if (Date.now() - last < ROTATE_AFTER_MS) return
  const base = relayHttpUrl()
  // eslint-disable-next-line no-console
  console.log(`[cloud] proactively rotating token for handle=${handle}`)
  try {
    const resp = await fetch(`${base}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle, currentToken: token }),
    })
    if (resp.status === 409) {
      // eslint-disable-next-line no-console
      console.warn('[cloud] rotation 409 — handle no longer ours, clearing state')
      clearHandle()
      return
    }
    if (!resp.ok) {
      const body = await resp.text().catch(() => '')
      // eslint-disable-next-line no-console
      console.error(`[cloud] rotation failed: ${resp.status} ${body}`)
      return
    }
    const data = (await resp.json()) as { handle: string; token: string }
    setRegistered(data.handle, data.token)
    const ticket = randomBytes(8).toString('hex')
    const ok = await postPhoneTicket(base, data.handle, data.token, ticket)
    if (!ok) {
      // Rollback — leaves the handle cleared so ensureRegistered() runs fresh.
      // eslint-disable-next-line no-console
      console.error('[cloud] /set-phone-ticket failed after rotation, rolling back')
      clearHandle()
      return
    }
    setPhoneTicket(ticket)
    touchLastRegisteredAt()
    // eslint-disable-next-line no-console
    console.log('[cloud] rotation complete')
  } catch (err) {
    const e = err as Error
    // eslint-disable-next-line no-console
    console.error(`[cloud] rotation error: ${e.message}`)
  }
}

async function postPhoneTicket(
  base: string,
  handle: string,
  token: string,
  ticket: string,
): Promise<boolean> {
  try {
    const resp = await fetch(`${base}/set-phone-ticket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle, token, ticket }),
    })
    if (!resp.ok) {
      // Legacy relay-backend doesn't implement /set-phone-ticket; treat 404 as
      // a no-op success so local/dev flows keep working. Cloudflare Worker
      // returns 200/401/400 only.
      if (resp.status === 404) return true
      return false
    }
    return true
  } catch {
    return false
  }
}

export async function unregisterCloud(): Promise<void> {
  const handle = getCurrentHandle()
  const token = getCurrentToken()
  if (!handle || !token) return
  const base = relayHttpUrl()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 2000)
  try {
    await fetch(`${base}/unregister`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle, token }),
      signal: ctrl.signal,
    })
  } catch {
    // best-effort
  } finally {
    clearTimeout(timer)
  }
}

export function stopCloudClient(): void {
  stopped = true
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (ws) {
    try { ws.close() } catch {}
    ws = null
  }
  if (detachBridge) {
    detachBridge()
    detachBridge = null
  }
  session = null
  setConnected(false)
}

export async function regenerateCloudHandle(): Promise<string> {
  clearHandle()
  stopCloudClient()
  await ensureRegistered()
  stopped = false
  scheduleConnect(0)
  return getCurrentHandle() ?? ''
}

// ---- Registration ----------------------------------------------------------

async function ensureRegistered(): Promise<void> {
  if (getCurrentHandle() && getCurrentToken()) {
    // eslint-disable-next-line no-console
    console.log(`[cloud] already registered: handle=${getCurrentHandle()}`)
    return
  }
  const base = relayHttpUrl()
  // eslint-disable-next-line no-console
  console.log(`[cloud] registering against ${base}`)
  for (let i = 0; i < 8; i++) {
    const handle = generateCandidateHandle()
    try {
      const resp = await fetch(`${base}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle }),
      })
      if (resp.status === 409) {
        // eslint-disable-next-line no-console
        console.log(`[cloud] handle ${handle} taken, retrying`)
        continue
      }
      if (!resp.ok) {
        const body = await resp.text().catch(() => '')
        throw new Error(`relay /register failed: ${resp.status} ${body}`)
      }
      const data = (await resp.json()) as { handle: string; token: string }
      setRegistered(data.handle, data.token)
      const ticket = randomBytes(8).toString('hex')
      const ok = await postPhoneTicket(base, data.handle, data.token, ticket)
      if (!ok) {
        // Roll back the half-state — don't leave a token persisted that the
        // user can't actually use because the phone has no ticket.
        clearHandle()
        // eslint-disable-next-line no-console
        console.error('[cloud] /set-phone-ticket failed after register, rolled back')
        throw new Error('relay /set-phone-ticket failed')
      }
      setPhoneTicket(ticket)
      // eslint-disable-next-line no-console
      console.log(`[cloud] registered: handle=${data.handle}`)
      return
    } catch (err) {
      const e = err as Error & { cause?: unknown; code?: string }
      const cause = e.cause as { code?: string; message?: string } | undefined
      const detail = cause ? `${cause.code ?? ''} ${cause.message ?? ''}`.trim() : ''
      const msg = `${e.message}${detail ? ` (cause: ${detail})` : ''}`
      // eslint-disable-next-line no-console
      console.error(`[cloud] register attempt ${i + 1} failed: ${msg}`)
      if (i === 7) throw new Error(`relay registration failed: ${msg}`)
    }
  }
  throw new Error('could not allocate a free handle after 8 attempts')
}

// ---- Connect loop ----------------------------------------------------------

function scheduleConnect(delay: number): void {
  if (stopped) return
  if (reconnectTimer) clearTimeout(reconnectTimer)
  reconnectTimer = setTimeout(connect, delay)
}

function connect(): void {
  reconnectTimer = null
  if (stopped) return
  const handle = getCurrentHandle()
  const token = getCurrentToken()
  if (!handle || !token) return
  const url = `${relayWsUrl()}/desktop?handle=${encodeURIComponent(handle)}&token=${encodeURIComponent(token)}`
  // eslint-disable-next-line no-console
  console.log(`[cloud] connecting ws to ${url.replace(token, token.slice(0, 8) + '…')}`)
  ws = new WebSocket(url)
  ws.on('open', () => {
    backoffMs = 1000
    // eslint-disable-next-line no-console
    console.log('[cloud] ws open')
    setConnected(true)
  })
  ws.on('message', (raw) => onRelayMessage(String(raw)))
  ws.on('close', (code, reason) => {
    // eslint-disable-next-line no-console
    console.log(`[cloud] ws close code=${code} reason=${reason?.toString() ?? ''}`)
    setConnected(false)
    session = null
    if (detachBridge) {
      detachBridge()
      detachBridge = null
    }
    if (stopped) return
    const delay = backoffMs
    backoffMs = Math.min(backoffMs * 2, 30_000)
    scheduleConnect(delay)
  })
  ws.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error(`[cloud] ws error: ${err instanceof Error ? err.message : String(err)}`)
    try { ws?.close() } catch {}
  })
}

function setConnected(v: boolean): void {
  if (connected === v) return
  connected = v
  onStatusChange?.()
}

// ---- Envelope handling ----------------------------------------------------

async function onRelayMessage(raw: string): Promise<void> {
  let env: CloudEnvelope
  try {
    env = JSON.parse(raw) as CloudEnvelope
  } catch {
    return
  }
  if (env.kind === 'peer-arrived' || env.kind === 'peer-gone' || env.kind === 'peer-absent') {
    // Reset session state whenever the phone disappears/arrives.
    session = null
    if (detachBridge) {
      detachBridge()
      detachBridge = null
    }
    setConnected(false)
    return
  }
  if (env.kind === 'hello') {
    await onHello(env)
    return
  }
  if (env.kind === 'data') {
    await onData(env)
    return
  }
  // hello-ack from a phone makes no sense; ignore.
}

async function onHello(hello: CloudHello): Promise<void> {
  // Pick the salt based on phone's announced mode.
  let salt: string | null = null
  if (hello.mode === 'pair') {
    salt = currentPairingCode()
  } else if (hello.mode === 'token' && hello.tokenId) {
    salt = findTokenByPrefix(hello.tokenId)
  }
  if (!salt) {
    // No code active or unknown token. Stay silent — phone will see hello-ack
    // never arrive and surface a generic error.
    return
  }
  const kp = await generateKeypair()
  const theirPub = await b64decode(hello.pubkey)
  const sharedKey = await deriveSharedKey(kp.privateKey, theirPub, salt)
  session = {
    sharedKey,
    myPriv: kp.privateKey,
    myPub: kp.publicKey,
    authed: false,
  }
  lastSafetyNumber = await safetyNumber(sharedKey)
  onStatusChange?.()
  const ack: CloudEnvelope = {
    kind: 'hello-ack',
    pubkey: await b64encode(kp.publicKey),
    safetyNumber: lastSafetyNumber,
  }
  sendEnvelope(ack)
}

async function onData(env: CloudData): Promise<void> {
  if (!session || !session.sharedKey) return
  let plaintext: string
  try {
    const nonce = await b64decode(env.nonce)
    const ct = await b64decode(env.payload)
    const pt = await open(session.sharedKey, nonce, ct)
    plaintext = new TextDecoder().decode(pt)
  } catch {
    // Decrypt failure → wrong code / token / MITM. Close the session.
    session = null
    if (detachBridge) {
      detachBridge()
      detachBridge = null
    }
    return
  }

  // First plaintext frame must be cloud-auth-req. After auth, all frames are
  // regular JsonFrames passed to the bridge.
  if (!session.authed) {
    let inner: CloudInner
    try {
      inner = JSON.parse(plaintext) as CloudInner
    } catch {
      return
    }
    if (inner.kind !== 'auth-req') return
    if (inner.mode === 'pair') {
      const code = currentPairingCode()
      if (!code) {
        await sendInner({ kind: 'auth-res', ok: false, error: 'no active code' })
        return
      }
      // Gate token issuance behind desktop approval (no-op when off).
      const approved = await awaitApproval(inner.label, 'cloud')
      if (!session || !session.sharedKey) return // session may have been torn down while we waited
      if (!approved) {
        await sendInner({ kind: 'auth-res', ok: false, error: 'pairing not approved' })
        return
      }
      // Salt was the code; if we got here, the phone had it. Consume now.
      consumePairingCode(code)
      const token = issueToken(inner.label)
      session.authed = true
      await sendInner({ kind: 'auth-res', ok: true, token })
    } else {
      // token mode — token validity was implicit in successful decrypt, but
      // double-check the store hasn't revoked it in the meantime.
      const token = findTokenByPrefix(inner.token.slice(0, 8))
      if (!token || token !== inner.token || !verifyToken(token)) {
        await sendInner({ kind: 'auth-res', ok: false, error: 'invalid token' })
        return
      }
      session.authed = true
      await sendInner({ kind: 'auth-res', ok: true, token })
    }
    attachBridgeForSession()
    setConnected(true)
    return
  }

  // Authed — hand off to the bridge via the active transport.
  bridgeIncoming?.(plaintext)
}

// ---- Bridge transport (encrypted) -----------------------------------------

let bridgeIncoming: ((frame: string) => void) | null = null

function attachBridgeForSession(): void {
  const closeHandlers = new Set<() => void>()
  const transport: Transport = {
    send: (frame) => {
      void sendEncryptedFrame(frame)
    },
    onMessage: (cb) => { bridgeIncoming = cb },
    onClose: (cb) => { closeHandlers.add(cb) },
  }
  const detach = attachBridgeToTransport(transport)
  detachBridge = () => {
    for (const cb of closeHandlers) cb()
    closeHandlers.clear()
    bridgeIncoming = null
    detach()
  }
}

async function sendEncryptedFrame(frame: string): Promise<void> {
  if (!session?.sharedKey) return
  const { nonce, ciphertext } = await seal(session.sharedKey, frame)
  sendEnvelope({
    kind: 'data',
    nonce: await b64encode(nonce),
    payload: await b64encode(ciphertext),
  })
}

async function sendInner(inner: CloudInner): Promise<void> {
  await sendEncryptedFrame(JSON.stringify(inner))
}

function sendEnvelope(env: CloudEnvelope): void {
  if (!ws || ws.readyState !== ws.OPEN) return
  try { ws.send(JSON.stringify(env)) } catch {}
}

// ---- Helpers ---------------------------------------------------------------

function findTokenByPrefix(prefix: string): string | null {
  // We don't have a direct read of full tokens from `auth.ts` (its `listDevices`
  // truncates), so reach into the store directly.
  const devicesStore = new Store<{ devices: { token: string; label: string; createdAt: number }[] }>({
    name: 'remote-devices',
    defaults: { devices: [] },
  })
  const match = devicesStore.get('devices', []).find((d) => d.token.startsWith(prefix))
  return match?.token ?? null
}
