/**
 * Unit tests for the relay Worker.
 *
 * Uses @cloudflare/vitest-pool-workers so the Worker, both DOs, and the KV
 * binding all run inside a real miniflare-backed Workers runtime — this is the
 * only way to exercise the WebSocket upgrade + DO alarm code paths without
 * standing up a substantial in-memory mock surface.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { env, SELF, reset } from 'cloudflare:test'

// We address the Worker through SELF.fetch so that the full pipeline
// (KV gate, rate limit DO, Room DO) is exercised.

const HANDLE = 'lively-ember-falcon'
const HANDLE_2 = 'misty-cobalt-otter'
const HANDLE_3 = 'sunny-amber-marten'

function register(handle: string, opts: { ip?: string; currentToken?: string } = {}) {
  return SELF.fetch('https://r/register', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': opts.ip ?? `1.2.3.${Math.floor(Math.random() * 250) + 1}`,
    },
    body: JSON.stringify({ handle, currentToken: opts.currentToken }),
  })
}

function setTicket(handle: string, token: string, ticket: string) {
  return SELF.fetch('https://r/set-phone-ticket', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ handle, token, ticket }),
  })
}

function phoneUpgrade(handle: string, ticket: string) {
  return SELF.fetch(`https://r/phone?handle=${handle}&ticket=${encodeURIComponent(ticket)}`, {
    headers: { Upgrade: 'websocket' },
  })
}

function desktopUpgrade(handle: string, token: string) {
  return SELF.fetch(`https://r/desktop?handle=${handle}&token=${encodeURIComponent(token)}`, {
    headers: { Upgrade: 'websocket' },
  })
}

function unregister(handle: string, token: string) {
  return SELF.fetch('https://r/unregister', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ handle, token }),
  })
}

beforeEach(async () => {
  // Wipe KV + DO state between tests so handles + rate-limit buckets are fresh.
  await reset()
})

describe('/phone 401 indistinguishability', () => {
  it('returns identical body and headers for unknown handle / no ticket / wrong ticket', async () => {
    // Path A: unknown handle (no /register call beforehand).
    const a = await phoneUpgrade(HANDLE, 'any-ticket-here')

    // Set up a known handle WITH a ticket for the other two probes.
    const reg = await register(HANDLE_2, { ip: '9.9.9.1' })
    expect(reg.status).toBe(200)
    const { token } = (await reg.json()) as { token: string }
    const tk = await setTicket(HANDLE_2, token, 'good-ticket-1234')
    expect(tk.status).toBe(200)

    // Path B: known handle, no ticket query param at all.
    const b = await SELF.fetch(`https://r/phone?handle=${HANDLE_2}`, {
      headers: { Upgrade: 'websocket' },
    })

    // Path C: known handle, wrong ticket.
    const c = await phoneUpgrade(HANDLE_2, 'wrong-ticket-zzzz')

    expect(a.status).toBe(401)
    expect(b.status).toBe(401)
    expect(c.status).toBe(401)

    const [ba, bb, bc] = await Promise.all([a.text(), b.text(), c.text()])
    expect(ba).toBe(bb)
    expect(bb).toBe(bc)

    // Content-Length identical across all three (the load-bearing header for
    // length-side-channel avoidance).
    expect(a.headers.get('content-length')).toBe(b.headers.get('content-length'))
    expect(b.headers.get('content-length')).toBe(c.headers.get('content-length'))
  })
})

describe('/register rate limit', () => {
  it('429s after the 5-token burst is exhausted on a single IP', async () => {
    const ip = '7.7.7.7'
    const results: number[] = []
    for (let i = 0; i < 6; i++) {
      // Use a fresh handle each time so handle-collision (409) isn't a confound.
      const handle = `flowing-river-${['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'][i]}`
      const r = await register(handle, { ip })
      results.push(r.status)
    }
    // First 5 succeed; 6th hits the bucket floor.
    expect(results.slice(0, 5)).toEqual([200, 200, 200, 200, 200])
    expect(results[5]).toBe(429)
  })
})

describe('/register rotation via currentToken', () => {
  it('rotates the token, invalidates phone ticket, and rejects the old token', async () => {
    const reg1 = await register(HANDLE, { ip: '8.8.8.1' })
    expect(reg1.status).toBe(200)
    const { token: oldToken } = (await reg1.json()) as { token: string }

    const oldTicket = 'first-ticket-1234'
    expect((await setTicket(HANDLE, oldToken, oldTicket)).status).toBe(200)

    // Sanity: ticket works before rotation (101 upgrade).
    const beforeRotate = await phoneUpgrade(HANDLE, oldTicket)
    expect(beforeRotate.status).toBe(101)
    // Close the resulting socket so we don't leak it.
    beforeRotate.webSocket?.accept()
    beforeRotate.webSocket?.close()

    const reg2 = await register(HANDLE, { ip: '8.8.8.2', currentToken: oldToken })
    expect(reg2.status).toBe(200)
    const { token: newToken } = (await reg2.json()) as { token: string }
    expect(newToken).not.toBe(oldToken)

    // Old token no longer works for unregister (proxy for "rejected").
    const stillOld = await unregister(HANDLE, oldToken)
    expect(stillOld.status).toBe(401)

    // Previously-set ticket is now invalid — /phone with it returns the
    // canonical 401.
    const afterRotate = await phoneUpgrade(HANDLE, oldTicket)
    expect(afterRotate.status).toBe(401)

    // The new token can still drive the room (e.g. set a new ticket).
    expect((await setTicket(HANDLE, newToken, 'second-ticket-9876')).status).toBe(200)
  })
})

describe('/unregister', () => {
  it('deletes storage so /desktop and /phone both 401 afterwards, and rejects wrong tokens', async () => {
    const reg = await register(HANDLE_3, { ip: '6.6.6.1' })
    expect(reg.status).toBe(200)
    const { token } = (await reg.json()) as { token: string }
    expect((await setTicket(HANDLE_3, token, 'pre-unreg-ticket-1')).status).toBe(200)

    // Wrong token is rejected.
    const wrong = await unregister(HANDLE_3, '00'.repeat(32))
    expect(wrong.status).toBe(401)

    // Correct token succeeds.
    const ok = await unregister(HANDLE_3, token)
    expect(ok.status).toBe(200)

    // Both upgrade endpoints now reject (handle removed from KV → 401).
    const d = await desktopUpgrade(HANDLE_3, token)
    expect(d.status).toBe(401)
    const p = await phoneUpgrade(HANDLE_3, 'pre-unreg-ticket-1')
    expect(p.status).toBe(401)
  })
})

describe('Room alarm cleanup', () => {
  it('wipes the room when the alarm fires past TTL, freeing the handle', async () => {
    const reg = await register(HANDLE, { ip: '5.5.5.1' })
    expect(reg.status).toBe(200)
    const { token: firstToken } = (await reg.json()) as { token: string }

    // Re-registering without currentToken collides (409) — proves the token
    // is currently held.
    const collide = await register(HANDLE, { ip: '5.5.5.2' })
    expect(collide.status).toBe(409)

    // Force the room's stored lastDesktopConnect way into the past so the
    // alarm body decides the TTL has elapsed, then trip the alarm.
    const stub = env.ROOM.get(env.ROOM.idFromName(HANDLE))
    // Mark the room idle and invoke the DO's alarm handler directly. We can't
    // rely on runDurableObjectAlarm here because the alarm may have already
    // fired (or not been set yet) — calling instance.alarm() is the
    // deterministic path.
    const { runInDurableObject } = await import('cloudflare:test')
    await runInDurableObject(stub, async (instance, state) => {
      await state.storage.put('lastDesktopConnect', 0)
      // Force the in-memory copy used by the alarm handler to also reflect
      // the idle marker.
      ;(instance as { lastDesktopConnect: number }).lastDesktopConnect = 0
      await (instance as { alarm: () => Promise<void> }).alarm()
    })

    // KV entry should also have been removed by purge? It isn't — purge() only
    // clears DO storage. But the prompt's success criterion is "a subsequent
    // /register should succeed without 409". The DO storage is gone, so the
    // next /register call inside the DO sees `this.token === null` and mints
    // a fresh one regardless of whether the KV marker still exists. The
    // worker's /register re-puts the KV marker too. So this assertion holds:
    const reg2 = await register(HANDLE, { ip: '5.5.5.3' })
    expect(reg2.status).toBe(200)
    const { token: secondToken } = (await reg2.json()) as { token: string }
    expect(secondToken).not.toBe(firstToken)
  })
})
