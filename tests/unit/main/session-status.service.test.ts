import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  listeners: [] as Array<(evt: { contextId: string; tabId: string; hookType: string }) => void>,
}))

vi.mock('../../../src/main/services/notification-server', () => ({
  onHookEvent: (fn: (evt: { contextId: string; tabId: string; hookType: string }) => void) => {
    hoisted.listeners.push(fn)
    return () => {
      hoisted.listeners = hoisted.listeners.filter((l) => l !== fn)
    }
  },
}))

import {
  allSessionStatuses,
  clearSessionStatus,
  getLastEventAt,
  getSessionStatus,
  installSessionStatusTracking,
  recordHookEvent,
  stopSessionStatusTracking,
} from '../../../src/main/services/session-status.service'

/** Push an event through the real subscription, as the hook server would. */
function fire(contextId: string, tabId: string, hookType: 'prompt' | 'notification' | 'stop') {
  for (const l of hoisted.listeners) l({ contextId, tabId, hookType })
}

beforeEach(() => {
  stopSessionStatusTracking()
  hoisted.listeners = []
})

describe('session status tracking', () => {
  it('starts with no opinion about an unseen session', () => {
    expect(getSessionStatus('never-seen')).toBeUndefined()
  })

  it('subscribes to hook events on install', () => {
    installSessionStatusTracking()
    fire('s1', 'agent', 'notification')
    expect(getSessionStatus('s1')).toBe('attention')
  })

  it('only subscribes once, so a second install does not double-count', () => {
    installSessionStatusTracking()
    installSessionStatusTracking()
    expect(hoisted.listeners).toHaveLength(1)
  })

  it('unsubscribes and forgets everything on stop', () => {
    installSessionStatusTracking()
    fire('s1', 'agent', 'notification')
    stopSessionStatusTracking()
    expect(hoisted.listeners).toHaveLength(0)
    expect(getSessionStatus('s1')).toBeUndefined()
  })

  it('rolls up the worst status across a session tabs', () => {
    recordHookEvent('s1', 'agent', 'prompt')
    recordHookEvent('s1', 'review', 'notification')
    // agent is running, review wants attention — attention wins.
    expect(getSessionStatus('s1')).toBe('attention')
  })

  it('keeps sessions independent', () => {
    recordHookEvent('s1', 'agent', 'notification')
    recordHookEvent('s2', 'agent', 'prompt')
    expect(getSessionStatus('s1')).toBe('attention')
    expect(getSessionStatus('s2')).toBe('running')
  })

  it('moves a session through its lifecycle', () => {
    recordHookEvent('s1', 'agent', 'prompt')
    expect(getSessionStatus('s1')).toBe('running')
    recordHookEvent('s1', 'agent', 'notification')
    expect(getSessionStatus('s1')).toBe('attention')
    recordHookEvent('s1', 'agent', 'stop')
    expect(getSessionStatus('s1')).toBe('completed')
  })

  it('stamps the last event time even for events that do not change status', () => {
    recordHookEvent('s1', 'agent', 'prompt')
    const first = getLastEventAt('s1')
    // A second prompt is a no-op for status but is still activity.
    recordHookEvent('s1', 'agent', 'prompt')
    expect(getSessionStatus('s1')).toBe('running')
    expect(getLastEventAt('s1')).toBeGreaterThanOrEqual(first!)
  })

  it('clears one session without touching the others', () => {
    recordHookEvent('s1', 'agent', 'attention' as never)
    recordHookEvent('s1', 'agent', 'notification')
    recordHookEvent('s2', 'agent', 'notification')
    clearSessionStatus('s1')
    expect(getSessionStatus('s1')).toBeUndefined()
    expect(getSessionStatus('s2')).toBe('attention')
  })

  it('lists every tracked session for the snapshot builder', () => {
    recordHookEvent('s1', 'agent', 'notification')
    recordHookEvent('s2', 'agent', 'prompt')
    const all = allSessionStatuses()
    expect(all.get('s1')).toBe('attention')
    expect(all.get('s2')).toBe('running')
    expect(all.size).toBe(2)
  })

  it('ignores an unrecognised hook type rather than throwing', () => {
    recordHookEvent('s1', 'agent', 'something-else' as never)
    expect(getSessionStatus('s1')).toBeUndefined()
  })
})
