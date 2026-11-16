import { describe, expect, it, vi } from 'vitest'
import {
  NOTIFICATION_RELAY_MARKER,
  NOTIFICATION_RELAY_SHIM,
  createNotificationDeduper,
  findCloudSessionId,
  installNotificationRelay,
  parseRelayedNotification,
} from '../../../src/main/services/claude-web-notifications'

const line = (payload: Record<string, unknown>) => NOTIFICATION_RELAY_MARKER + JSON.stringify(payload)

describe('findCloudSessionId', () => {
  it('finds a session id anywhere in the text', () => {
    expect(findCloudSessionId('https://claude.ai/code/session_01AbCdEfGh?x=1')).toBe('session_01AbCdEfGh')
    expect(findCloudSessionId('{"sessionId":"session_0123456789"}')).toBe('session_0123456789')
    expect(findCloudSessionId('https://claude.ai/code')).toBeNull()
    expect(findCloudSessionId(null)).toBeNull()
  })
})

describe('parseRelayedNotification', () => {
  it('ignores ordinary console lines', () => {
    expect(parseRelayedNotification('hello')).toBeNull()
    expect(parseRelayedNotification(42)).toBeNull()
    expect(parseRelayedNotification(NOTIFICATION_RELAY_MARKER + '{not json')).toBeNull()
    expect(parseRelayedNotification(line({ title: '', body: '' }))).toBeNull()
  })

  it("prefers the notification's own session id over the page URL", () => {
    expect(
      parseRelayedNotification(
        line({
          title: 'Claude needs your input',
          body: 'Approve running npm test?',
          tag: 'session_TagTagTag01',
          data: '{"url":"https://claude.ai/code/session_DataData01"}',
          url: 'https://claude.ai/code/session_PagePage01',
        }),
      ),
    ).toEqual({ title: 'Claude needs your input', body: 'Approve running npm test?', cloudSessionId: 'session_TagTagTag01' })
    expect(
      parseRelayedNotification(line({ title: 'Done', data: '{"url":"https://claude.ai/code/session_DataData01"}', url: 'https://claude.ai/code/session_PagePage01' }))
        ?.cloudSessionId,
    ).toBe('session_DataData01')
    expect(parseRelayedNotification(line({ title: 'Done', url: 'https://claude.ai/code/session_PagePage01' }))?.cloudSessionId).toBe(
      'session_PagePage01',
    )
    expect(parseRelayedNotification(line({ title: 'Done', url: 'https://claude.ai/code' }))?.cloudSessionId).toBeNull()
  })

  it('collapses whitespace and clips long text', () => {
    const n = parseRelayedNotification(line({ title: ' a\n b ', body: 'x'.repeat(5000) }))!
    expect(n.title).toBe('a b')
    expect(n.body.length).toBe(1000)
    expect(n.body.endsWith('…')).toBe(true)
  })
})

describe('createNotificationDeduper', () => {
  it('drops the same notification from several pages within the window', () => {
    let t = 0
    const fresh = createNotificationDeduper(5000, () => t)
    const n = { title: 'Done', body: 'b', cloudSessionId: 'session_0123456789' }
    expect(fresh(n, 'guest:1')).toBe(true)
    expect(fresh(n, 'guest:2')).toBe(false)
    expect(fresh({ ...n, cloudSessionId: 'session_9876543210' }, 'guest:1')).toBe(true)
    t = 6000
    expect(fresh(n, 'guest:1')).toBe(true)
  })

  it('keys notifications without a session id by the page', () => {
    const fresh = createNotificationDeduper(5000, () => 0)
    const n = { title: 'Done', body: '', cloudSessionId: null }
    expect(fresh(n, 'guest:1')).toBe(true)
    expect(fresh(n, 'guest:2')).toBe(true)
    expect(fresh(n, 'guest:1')).toBe(false)
  })
})

describe('the injected shim', () => {
  it('reports granted permission and logs each notification instead of showing it', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const RealNotification = (window as any).Notification
    try {
      window.eval(NOTIFICATION_RELAY_SHIM)
      window.eval(NOTIFICATION_RELAY_SHIM) // idempotent
      const N = (window as any).Notification
      expect(N.permission).toBe('granted')
      const cb = vi.fn()
      await expect(N.requestPermission(cb)).resolves.toBe('granted')
      expect(cb).toHaveBeenCalledWith('granted')
      const shown = vi.fn()
      const n = new N('Claude needs your input', { body: 'Approve?', tag: 'session_01AbCdEfGh' })
      n.onshow = shown
      await Promise.resolve()
      expect(shown).toHaveBeenCalled()
      expect(debug).toHaveBeenCalledTimes(1)
      const parsed = parseRelayedNotification(debug.mock.calls[0][0])
      expect(parsed).toEqual({ title: 'Claude needs your input', body: 'Approve?', cloudSessionId: 'session_01AbCdEfGh' })
      const closed = vi.fn()
      n.addEventListener('close', closed)
      n.close()
      expect(closed).toHaveBeenCalled()
    } finally {
      debug.mockRestore()
      ;(window as any).Notification = RealNotification
    }
  })
})

function fakeGuest(id = 9) {
  const listeners = new Map<string, (...args: any[]) => void>()
  return {
    id,
    destroyed: false,
    isDestroyed() {
      return this.destroyed
    },
    executeJavaScript: vi.fn(async () => undefined),
    on: vi.fn((event: string, fn: (...args: any[]) => void) => listeners.set(event, fn)),
    emit: (event: string, ...args: any[]) => listeners.get(event)?.(...args),
  }
}

describe('installNotificationRelay', () => {
  it('injects the shim on each document load', () => {
    const guest = fakeGuest()
    installNotificationRelay(guest as any, () => {})
    guest.emit('dom-ready')
    expect(guest.executeJavaScript).toHaveBeenCalledWith(NOTIFICATION_RELAY_SHIM)
    guest.destroyed = true
    guest.emit('dom-ready')
    expect(guest.executeJavaScript).toHaveBeenCalledTimes(1)
  })

  it('passes on marked console lines, in either console-message signature', () => {
    const guest = fakeGuest(11)
    const onNotify = vi.fn()
    installNotificationRelay(guest as any, onNotify)
    guest.emit('console-message', {}, 0, 'unrelated log line')
    guest.emit('console-message', {}, 0, line({ title: 'Relay test A', body: 'one', url: 'https://claude.ai/code/session_RelayTest01' }))
    guest.emit('console-message', { message: line({ title: 'Relay test B', body: 'two' }) })
    expect(onNotify).toHaveBeenCalledTimes(2)
    expect(onNotify).toHaveBeenNthCalledWith(1, { title: 'Relay test A', body: 'one', cloudSessionId: 'session_RelayTest01' })
    expect(onNotify).toHaveBeenNthCalledWith(2, { title: 'Relay test B', body: 'two', cloudSessionId: null })
  })
})
