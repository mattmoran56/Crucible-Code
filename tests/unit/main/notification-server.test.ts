import { beforeEach, describe, expect, it, vi } from 'vitest'

// notification-server pulls in electron + a couple of services at module load;
// stub them so the hook-event emitter can be tested in isolation. With no main
// window set and no registered context mapping, handleHookEvent's only
// observable effect is the in-process hook emit — exactly what we assert on.
vi.mock('electron', () => ({
  app: { dock: { setBadge: () => {} }, setBadgeCount: () => {} },
  BrowserWindow: class {},
}))
vi.mock('../../../src/main/services/notification.service', () => ({
  showNotification: () => {},
}))
vi.mock('../../../src/main/services/event-bus', () => ({
  emitToRenderer: () => {},
}))

import { handleHookEvent, onHookEvent } from '../../../src/main/services/notification-server'

describe('notification-server onHookEvent', () => {
  it('fans a routed hook event out to subscribers', () => {
    const received: Array<{ contextId: string; tabId: string; hookType: string }> = []
    const off = onHookEvent((e) => received.push(e))

    handleHookEvent('sess-1', 'review-loop:r1:review', 'stop')

    expect(received).toEqual([
      { contextId: 'sess-1', tabId: 'review-loop:r1:review', hookType: 'stop' },
    ])
    off()
  })

  it('delivers to every active subscriber', () => {
    const a: string[] = []
    const b: string[] = []
    const offA = onHookEvent((e) => a.push(e.tabId))
    const offB = onHookEvent((e) => b.push(e.tabId))

    handleHookEvent('sess-1', 'review-loop:r2:fix', 'stop')

    expect(a).toEqual(['review-loop:r2:fix'])
    expect(b).toEqual(['review-loop:r2:fix'])
    offA()
    offB()
  })

  it('stops delivering after unsubscribe', () => {
    const received: string[] = []
    const off = onHookEvent((e) => received.push(e.hookType))

    handleHookEvent('sess-1', 'agent', 'notification')
    off()
    handleHookEvent('sess-1', 'agent', 'stop')

    expect(received).toEqual(['notification']) // the post-unsubscribe 'stop' is not delivered
  })

  it('forwards all hook types (prompt / notification / stop)', () => {
    const types: string[] = []
    const off = onHookEvent((e) => types.push(e.hookType))

    handleHookEvent('c', 't', 'prompt')
    handleHookEvent('c', 't', 'notification')
    handleHookEvent('c', 't', 'stop')

    expect(types).toEqual(['prompt', 'notification', 'stop'])
    off()
  })
})
