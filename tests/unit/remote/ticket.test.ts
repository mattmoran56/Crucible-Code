// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { deriveTicket } from '../../../remote/protocol/ticket'

describe('deriveTicket', () => {
  it('is deterministic for the same (handle, code)', async () => {
    const a = await deriveTicket('lively-ember-falcon', 'ABCDEF')
    const b = await deriveTicket('lively-ember-falcon', 'ABCDEF')
    expect(a).toBe(b)
  })

  it('is case-insensitive on handle and code', async () => {
    const lower = await deriveTicket('lively-ember-falcon', 'ABCDEF')
    const upperHandle = await deriveTicket('LIVELY-EMBER-FALCON', 'ABCDEF')
    const lowerCode = await deriveTicket('lively-ember-falcon', 'abcdef')
    const mixed = await deriveTicket('Lively-Ember-Falcon', 'aBcDeF')
    expect(upperHandle).toBe(lower)
    expect(lowerCode).toBe(lower)
    expect(mixed).toBe(lower)
  })

  it('produces a different ticket for a different code', async () => {
    const a = await deriveTicket('lively-ember-falcon', 'ABCDEF')
    const b = await deriveTicket('lively-ember-falcon', 'GHIJKL')
    expect(a).not.toBe(b)
  })

  it('produces a different ticket for a different handle', async () => {
    const a = await deriveTicket('lively-ember-falcon', 'ABCDEF')
    const b = await deriveTicket('misty-cobalt-otter', 'ABCDEF')
    expect(a).not.toBe(b)
  })

  it('returns a 64-character lowercase hex string', async () => {
    const t = await deriveTicket('lively-ember-falcon', 'ABCDEF')
    expect(t).toHaveLength(64)
    expect(t).toMatch(/^[0-9a-f]{64}$/)
  })
})
