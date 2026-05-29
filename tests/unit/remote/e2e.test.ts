// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  generateKeypair,
  deriveSharedKey,
  seal,
  open,
  safetyNumber,
  b64encode,
  b64decode,
} from '../../../remote/protocol/e2e'

describe('e2e key exchange', () => {
  it('two parties derive the same shared key from matching salt', async () => {
    const a = await generateKeypair()
    const b = await generateKeypair()
    const k1 = await deriveSharedKey(a.privateKey, b.publicKey, 'ABCDEF')
    const k2 = await deriveSharedKey(b.privateKey, a.publicKey, 'ABCDEF')
    expect(Array.from(k1)).toEqual(Array.from(k2))
  })

  it('mismatched salt → different keys → safety numbers differ', async () => {
    const a = await generateKeypair()
    const b = await generateKeypair()
    const k1 = await deriveSharedKey(a.privateKey, b.publicKey, 'ABCDEF')
    const k2 = await deriveSharedKey(b.privateKey, a.publicKey, 'WRONG_')
    const s1 = await safetyNumber(k1)
    const s2 = await safetyNumber(k2)
    expect(s1).not.toEqual(s2)
  })

  it('seal/open round-trips a frame', async () => {
    const a = await generateKeypair()
    const b = await generateKeypair()
    const key = await deriveSharedKey(a.privateKey, b.publicKey, 'salt-1')
    const plaintext = JSON.stringify({ kind: 'req', id: '1', channel: 'project:list', args: [] })
    const { nonce, ciphertext } = await seal(key, plaintext)
    const opened = await open(key, nonce, ciphertext)
    expect(new TextDecoder().decode(opened)).toEqual(plaintext)
  })

  it('open with wrong key throws', async () => {
    const a = await generateKeypair()
    const b = await generateKeypair()
    const c = await generateKeypair()
    const goodKey = await deriveSharedKey(a.privateKey, b.publicKey, 'salt-1')
    const badKey = await deriveSharedKey(a.privateKey, c.publicKey, 'salt-1')
    const { nonce, ciphertext } = await seal(goodKey, 'hello')
    await expect(open(badKey, nonce, ciphertext)).rejects.toThrow()
  })

  it('base64 round-trips bytes', async () => {
    const buf = new Uint8Array([1, 2, 3, 4, 5, 255, 0, 128])
    const s = await b64encode(buf)
    const back = await b64decode(s)
    expect(Array.from(back)).toEqual(Array.from(buf))
  })
})
