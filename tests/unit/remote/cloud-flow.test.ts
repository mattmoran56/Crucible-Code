// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { WebSocket } from 'ws'
import {
  generateKeypair,
  deriveSharedKey,
  seal,
  open as e2eOpen,
  b64encode,
  b64decode,
} from '../../../remote/protocol/e2e'

/**
 * End-to-end flow test: boots the real relay-backend, opens a fake desktop and
 * fake phone, runs the hello / hello-ack / encrypted-auth handshake, and
 * verifies the relay never sees plaintext IPC.
 */

const RELAY_PORT = 9100
const RELAY_URL = `http://localhost:${RELAY_PORT}`

let relay: ChildProcess

function waitForHealth(timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const r = await fetch(`${RELAY_URL}/health`)
        if (r.ok) return resolve()
      } catch {}
      if (Date.now() - start > timeoutMs) return reject(new Error('relay did not start'))
      setTimeout(tick, 50)
    }
    tick()
  })
}

function recv(ws: WebSocket): Promise<string> {
  return new Promise((resolve) => {
    ws.once('message', (data) => resolve(String(data)))
  })
}

beforeAll(async () => {
  const dir = path.resolve(__dirname, '../../../relay-backend')
  relay = spawn('node', ['--import', 'tsx', 'src/index.ts'], {
    cwd: dir,
    env: { ...process.env, PORT: String(RELAY_PORT) },
    stdio: 'ignore',
  })
  await waitForHealth()
}, 10_000)

afterAll(() => {
  relay?.kill('SIGTERM')
})

describe('cloud relay flow', () => {
  it('two clients in the same room exchange encrypted frames', async () => {
    // Desktop registers a handle.
    const reg = await fetch(`${RELAY_URL}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle: 'alpha-beta-gamma' }),
    })
    expect(reg.ok).toBe(true)
    const { handle, token } = (await reg.json()) as { handle: string; token: string }

    // Open desktop and phone sockets.
    const desktop = new WebSocket(
      `ws://localhost:${RELAY_PORT}/desktop?handle=${handle}&token=${token}`
    )
    await new Promise<void>((r) => desktop.once('open', () => r()))

    const phone = new WebSocket(`ws://localhost:${RELAY_PORT}/phone?handle=${handle}`)
    await new Promise<void>((r) => phone.once('open', () => r()))

    // peer-arrived notice should land at the desktop side.
    const peerArrived = JSON.parse(await recv(desktop))
    expect(peerArrived.kind).toBe('peer-arrived')

    // Phone sends hello.
    const phoneKp = await generateKeypair()
    phone.send(
      JSON.stringify({
        kind: 'hello',
        pubkey: await b64encode(phoneKp.publicKey),
        label: 'iphone',
        mode: 'pair',
      })
    )

    // Desktop receives hello, derives shared key, sends hello-ack.
    const helloRaw = await recv(desktop)
    const hello = JSON.parse(helloRaw) as { pubkey: string }
    expect(JSON.parse(helloRaw).kind).toBe('hello')
    const desktopKp = await generateKeypair()
    const sharedDesktop = await deriveSharedKey(
      desktopKp.privateKey,
      await b64decode(hello.pubkey),
      'ABCDEF'
    )
    desktop.send(
      JSON.stringify({
        kind: 'hello-ack',
        pubkey: await b64encode(desktopKp.publicKey),
        safetyNumber: '123 456',
      })
    )

    // Phone receives hello-ack, derives the same key.
    const ackRaw = await recv(phone)
    const ack = JSON.parse(ackRaw) as { pubkey: string }
    const sharedPhone = await deriveSharedKey(
      phoneKp.privateKey,
      await b64decode(ack.pubkey),
      'ABCDEF'
    )
    expect(Array.from(sharedPhone)).toEqual(Array.from(sharedDesktop))

    // Phone sends an encrypted payload.
    const { nonce, ciphertext } = await seal(sharedPhone, JSON.stringify({ kind: 'ping' }))
    phone.send(
      JSON.stringify({
        kind: 'data',
        nonce: await b64encode(nonce),
        payload: await b64encode(ciphertext),
      })
    )

    // Desktop receives the encrypted envelope and decrypts.
    const dataRaw = await recv(desktop)
    const env = JSON.parse(dataRaw) as { kind: string; nonce: string; payload: string }
    expect(env.kind).toBe('data')
    // The on-wire payload must be ciphertext — never the plaintext JSON.
    expect(env.payload).not.toContain('ping')
    const pt = await e2eOpen(
      sharedDesktop,
      await b64decode(env.nonce),
      await b64decode(env.payload)
    )
    expect(new TextDecoder().decode(pt)).toBe(JSON.stringify({ kind: 'ping' }))

    desktop.close()
    phone.close()
  }, 10_000)
})
