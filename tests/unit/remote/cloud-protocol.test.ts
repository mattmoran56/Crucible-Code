// @vitest-environment node
import { describe, it, expect } from 'vitest'
import type {
  CloudEnvelope,
  CloudHello,
  CloudHelloAck,
  CloudData,
  CloudRelayNotice,
  CloudAuthReq,
  CloudAuthRes,
  CloudInner,
} from '../../../remote/protocol/cloud'
import {
  generateKeypair,
  deriveSharedKey,
  seal,
  open,
  safetyNumber,
  b64encode,
  b64decode,
} from '../../../remote/protocol/e2e'

function roundTrip<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

describe('remote/protocol/cloud envelope serialization', () => {
  it('round-trips a first-contact hello (mode=pair, no tokenId)', () => {
    const hello: CloudHello = { kind: 'hello', pubkey: 'cHVi', label: "Matt's iPhone", mode: 'pair' }
    const out = roundTrip(hello)
    expect(out).toEqual(hello)
    expect(out.tokenId).toBeUndefined()
  })

  it('round-trips a reconnect hello carrying an 8-char tokenId', () => {
    const hello: CloudHello = {
      kind: 'hello',
      pubkey: 'cHVi',
      label: 'pixel',
      mode: 'token',
      tokenId: 'deadbeef',
    }
    const out = roundTrip(hello)
    expect(out.mode).toBe('token')
    expect(out.tokenId).toBe('deadbeef')
  })

  it('round-trips a hello-ack with the displayed safety number', () => {
    const ack: CloudHelloAck = { kind: 'hello-ack', pubkey: 'cHVi', safetyNumber: '042 137' }
    expect(roundTrip(ack)).toEqual(ack)
  })

  it('round-trips relay notices (peer-gone / peer-absent / peer-arrived)', () => {
    const notices: CloudRelayNotice[] = [
      { kind: 'peer-gone' },
      { kind: 'peer-absent' },
      { kind: 'peer-arrived' },
    ]
    for (const n of notices) expect(roundTrip(n)).toEqual(n)
  })

  it('kind discriminant resolves every envelope variant after JSON parsing', () => {
    const envelopes: CloudEnvelope[] = [
      { kind: 'hello', pubkey: 'a', label: 'l', mode: 'pair' },
      { kind: 'hello-ack', pubkey: 'b', safetyNumber: '111 222' },
      { kind: 'data', nonce: 'bm9uY2U=', payload: 'Y3Q=' },
      { kind: 'peer-gone' },
      { kind: 'peer-absent' },
      { kind: 'peer-arrived' },
    ]
    const kinds = envelopes.map((e) => (roundTrip(e) as CloudEnvelope).kind)
    expect(kinds).toEqual(['hello', 'hello-ack', 'data', 'peer-gone', 'peer-absent', 'peer-arrived'])
  })

  it('round-trips an auth-req in pair mode that carries NO secret material', () => {
    const req: CloudAuthReq = { kind: 'auth-req', mode: 'pair', label: 'phone' }
    const out = roundTrip(req)
    expect(out).toEqual(req)
    // Pair mode proves the code via decryptability — the frame itself must not
    // carry a token/code field.
    expect('token' in out).toBe(false)
    expect('code' in out).toBe(false)
  })

  it('round-trips an auth-req in token mode with the bearer token', () => {
    const req: CloudAuthReq = { kind: 'auth-req', mode: 'token', token: 'ff'.repeat(32), label: 'p' }
    const out = roundTrip(req)
    expect(out.mode).toBe('token')
    if (out.mode === 'token') expect(out.token).toBe('ff'.repeat(32))
  })

  it('round-trips both auth-res variants', () => {
    const ok: CloudAuthRes = { kind: 'auth-res', ok: true, token: 'ab'.repeat(32) }
    const err: CloudAuthRes = { kind: 'auth-res', ok: false, error: 'pairing not approved' }
    const okOut = roundTrip(ok)
    const errOut = roundTrip(err)
    expect(okOut).toEqual(ok)
    expect(errOut).toEqual(err)
    if (!errOut.ok) expect(errOut.error).toBe('pairing not approved')
  })

  it('CloudInner discriminates auth-req from auth-res by kind', () => {
    const inners: CloudInner[] = [
      { kind: 'auth-req', mode: 'pair', label: 'x' },
      { kind: 'auth-res', ok: true, token: 't' },
    ]
    expect(inners.map((i) => roundTrip(i).kind)).toEqual(['auth-req', 'auth-res'])
  })
})

describe('remote/protocol/cloud data envelopes over the e2e layer', () => {
  it('a sealed JsonFrame travels as a valid CloudData envelope and decrypts intact', async () => {
    const a = await generateKeypair()
    const b = await generateKeypair()
    const key = await deriveSharedKey(a.privateKey, b.publicKey, 'CODE42')
    const frame = JSON.stringify({ kind: 'req', id: '9', channel: 'session:list', args: [] })
    const { nonce, ciphertext } = await seal(key, frame)
    const env: CloudData = {
      kind: 'data',
      nonce: await b64encode(nonce),
      payload: await b64encode(ciphertext),
    }
    // Simulate the relay forwarding the envelope as opaque JSON.
    const forwarded = roundTrip(env)
    const pt = await open(key, await b64decode(forwarded.nonce), await b64decode(forwarded.payload))
    expect(new TextDecoder().decode(pt)).toBe(frame)
  })

  it('the relay-visible envelope never contains the plaintext frame', async () => {
    const a = await generateKeypair()
    const b = await generateKeypair()
    const key = await deriveSharedKey(a.privateKey, b.publicKey, 'CODE42')
    const secret = 'super-secret-project-name'
    const { nonce, ciphertext } = await seal(key, JSON.stringify({ secret }))
    const wire = JSON.stringify({
      kind: 'data',
      nonce: await b64encode(nonce),
      payload: await b64encode(ciphertext),
    })
    expect(wire).not.toContain(secret)
    expect(wire).not.toContain('super-secret')
  })

  it('a data envelope produced under one pairing code cannot be opened under another', async () => {
    const desktop = await generateKeypair()
    const phone = await generateKeypair()
    const rightKey = await deriveSharedKey(phone.privateKey, desktop.publicKey, 'RIGHT1')
    const wrongKey = await deriveSharedKey(desktop.privateKey, phone.publicKey, 'WRONG1')
    const { nonce, ciphertext } = await seal(rightKey, 'hello')
    await expect(open(wrongKey, nonce, ciphertext)).rejects.toThrow()
  })

  it('hello-ack safety number matches what the phone derives from the same key', async () => {
    const desktop = await generateKeypair()
    const phone = await generateKeypair()
    const desktopKey = await deriveSharedKey(desktop.privateKey, phone.publicKey, 'ABC234')
    const phoneKey = await deriveSharedKey(phone.privateKey, desktop.publicKey, 'ABC234')
    const ack: CloudHelloAck = {
      kind: 'hello-ack',
      pubkey: await b64encode(desktop.publicKey),
      safetyNumber: await safetyNumber(desktopKey),
    }
    expect(await safetyNumber(phoneKey)).toBe(roundTrip(ack).safetyNumber)
  })
})
