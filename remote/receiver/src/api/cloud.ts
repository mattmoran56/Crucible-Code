/**
 * Receiver-side cloud-mode transport. Wraps the relay WebSocket with the
 * libsodium key exchange + XChaCha20-Poly1305 sealed envelopes defined in
 * `@protocol/cloud`.
 *
 * The exported `CloudConnection` exposes the same `send(string)` /
 * `onMessage(cb)` shape as a raw WebSocket so the existing wsClient can use it
 * as a drop-in transport once auth completes.
 */

import {
  generateKeypair,
  deriveSharedKey,
  seal,
  open as e2eOpen,
  safetyNumber,
  b64encode,
  b64decode,
} from '@protocol/e2e'
import type {
  CloudEnvelope,
  CloudHello,
  CloudHelloAck,
  CloudData,
  CloudInner,
} from '@protocol/cloud'

const STORAGE_HANDLE = 'codecrucible-remote-handle'
const STORAGE_CLOUD_TOKEN = 'codecrucible-remote-cloud-token'

export function getStoredHandle(): string | null {
  return localStorage.getItem(STORAGE_HANDLE)
}

export function setStoredHandle(h: string): void {
  localStorage.setItem(STORAGE_HANDLE, h)
}

export function clearStoredHandle(): void {
  localStorage.removeItem(STORAGE_HANDLE)
  localStorage.removeItem(STORAGE_CLOUD_TOKEN)
}

export function getCloudToken(): string | null {
  return localStorage.getItem(STORAGE_CLOUD_TOKEN)
}

function setCloudToken(t: string): void {
  localStorage.setItem(STORAGE_CLOUD_TOKEN, t)
}

export interface CloudConnectOptions {
  handle: string
  code?: string // required when no stored token
  label: string
  onSafetyNumber: (s: string) => void
  onAuthed: () => void
  onAuthFailed: (error: string) => void
}

export interface CloudConnection {
  send(frame: string): void
  onMessage(cb: (frame: string) => void): void
  close(): void
  readyState: () => number
}

/**
 * Detect whether we were served from a hosted relay (cloud mode) or from a
 * desktop's embedded LAN relay (LAN mode). The two `/health` shapes differ:
 *   - LAN relay returns `{ok, hasCode}`
 *   - hosted relay returns `{ok, rooms}`
 */
export async function detectCloudMode(): Promise<boolean> {
  try {
    const r = await fetch('/health')
    if (!r.ok) return false
    const body = (await r.json()) as Record<string, unknown>
    return 'rooms' in body
  } catch {
    return false
  }
}

export async function openCloudConnection(opts: CloudConnectOptions): Promise<CloudConnection> {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const ws = new WebSocket(
    `${proto}://${location.host}/phone?handle=${encodeURIComponent(opts.handle)}`
  )

  const kp = await generateKeypair()
  let sharedKey: Uint8Array | null = null
  let authed = false
  const messageHandlers = new Set<(s: string) => void>()
  const pendingFrames: string[] = []

  const storedToken = getCloudToken()
  const mode: 'pair' | 'token' = storedToken ? 'token' : 'pair'
  const salt = mode === 'pair' ? opts.code ?? '' : storedToken!

  ws.binaryType = 'arraybuffer'
  ws.onopen = async () => {
    const hello: CloudHello = {
      kind: 'hello',
      pubkey: await b64encode(kp.publicKey),
      label: opts.label,
      mode,
      tokenId: mode === 'token' ? storedToken!.slice(0, 8) : undefined,
    }
    ws.send(JSON.stringify(hello))
  }

  ws.onmessage = async (ev) => {
    if (typeof ev.data !== 'string') return
    let env: CloudEnvelope
    try {
      env = JSON.parse(ev.data) as CloudEnvelope
    } catch {
      return
    }

    if (env.kind === 'peer-absent') {
      opts.onAuthFailed('desktop is offline')
      ws.close()
      return
    }
    if (env.kind === 'peer-gone') {
      opts.onAuthFailed('desktop disconnected')
      ws.close()
      return
    }

    if (env.kind === 'hello-ack') {
      const ack = env as CloudHelloAck
      const theirPub = await b64decode(ack.pubkey)
      sharedKey = await deriveSharedKey(kp.privateKey, theirPub, salt)
      opts.onSafetyNumber(ack.safetyNumber)
      // Send encrypted auth-req.
      const inner: CloudInner =
        mode === 'pair'
          ? { kind: 'auth-req', mode: 'pair', label: opts.label }
          : { kind: 'auth-req', mode: 'token', token: storedToken!, label: opts.label }
      const { nonce, ciphertext } = await seal(sharedKey, JSON.stringify(inner))
      const dataEnv: CloudData = {
        kind: 'data',
        nonce: await b64encode(nonce),
        payload: await b64encode(ciphertext),
      }
      ws.send(JSON.stringify(dataEnv))
      return
    }

    if (env.kind === 'data') {
      if (!sharedKey) return
      let plaintext: string
      try {
        const nonce = await b64decode(env.nonce)
        const ct = await b64decode(env.payload)
        const pt = await e2eOpen(sharedKey, nonce, ct)
        plaintext = new TextDecoder().decode(pt)
      } catch {
        opts.onAuthFailed('decryption failed — wrong code or possible MITM')
        ws.close()
        return
      }
      if (!authed) {
        let inner: CloudInner
        try {
          inner = JSON.parse(plaintext) as CloudInner
        } catch {
          return
        }
        if (inner.kind !== 'auth-res') return
        if (!inner.ok) {
          opts.onAuthFailed(inner.error)
          ws.close()
          return
        }
        setCloudToken(inner.token)
        authed = true
        opts.onAuthed()
        // Flush anything queued by the consumer before auth completed.
        for (const f of pendingFrames) void encryptAndSend(f)
        pendingFrames.length = 0
        return
      }
      // Authed traffic — pass plaintext JsonFrame up to wsClient.
      for (const cb of messageHandlers) cb(plaintext)
    }
  }

  async function encryptAndSend(frame: string): Promise<void> {
    if (!sharedKey) return
    const { nonce, ciphertext } = await seal(sharedKey, frame)
    const env: CloudData = {
      kind: 'data',
      nonce: await b64encode(nonce),
      payload: await b64encode(ciphertext),
    }
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(env))
  }

  return {
    send(frame: string) {
      if (!authed) {
        pendingFrames.push(frame)
        return
      }
      void encryptAndSend(frame)
    },
    onMessage(cb) {
      messageHandlers.add(cb)
    },
    close() {
      try { ws.close() } catch {}
    },
    readyState: () => ws.readyState,
  }
}
