import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useNotificationStore } from '../../../src/renderer/stores/notificationStore'

const setBadge = vi.fn()
beforeEach(() => {
  setBadge.mockClear()
  ;(globalThis as any).window = (globalThis as any).window ?? {}
  ;(window as any).api = { notification: { setBadge } }
  useNotificationStore.setState({
    contextStatuses: new Map(),
    sessionProjectMap: new Map(),
    stoppedWhileAttention: new Set(),
  })
})

describe('notificationStore.handleHookEvent', () => {
  it('prompt → running for a fresh tab', () => {
    useNotificationStore.getState().handleHookEvent('s1', 't1', 'prompt')
    expect(useNotificationStore.getState().getTabStatus('s1', 't1')).toBe('running')
  })

  it('prompt is a no-op when already running (does not call setBadge)', () => {
    useNotificationStore.getState().handleHookEvent('s1', 't1', 'prompt')
    setBadge.mockClear()
    useNotificationStore.getState().handleHookEvent('s1', 't1', 'prompt')
    expect(useNotificationStore.getState().getTabStatus('s1', 't1')).toBe('running')
    expect(setBadge).not.toHaveBeenCalled()
  })

  it('notification → attention', () => {
    useNotificationStore.getState().handleHookEvent('s1', 't1', 'notification')
    expect(useNotificationStore.getState().getTabStatus('s1', 't1')).toBe('attention')
  })

  it('stop on a non-attention tab → completed', () => {
    useNotificationStore.getState().handleHookEvent('s1', 't1', 'prompt')
    useNotificationStore.getState().handleHookEvent('s1', 't1', 'stop')
    expect(useNotificationStore.getState().getTabStatus('s1', 't1')).toBe('completed')
  })

  it('stop while in attention defers the transition (still attention until cleared)', () => {
    useNotificationStore.getState().handleHookEvent('s1', 't1', 'notification')
    useNotificationStore.getState().handleHookEvent('s1', 't1', 'stop')
    expect(useNotificationStore.getState().getTabStatus('s1', 't1')).toBe('attention')
  })

  it('clearTabStatus on attention+stopped clears entirely', () => {
    useNotificationStore.getState().handleHookEvent('s1', 't1', 'notification')
    useNotificationStore.getState().handleHookEvent('s1', 't1', 'stop')
    useNotificationStore.getState().clearTabStatus('s1', 't1')
    expect(useNotificationStore.getState().getTabStatus('s1', 't1')).toBeNull()
  })

  it('clearTabStatus on attention without stop reverts to running', () => {
    useNotificationStore.getState().handleHookEvent('s1', 't1', 'notification')
    useNotificationStore.getState().clearTabStatus('s1', 't1')
    expect(useNotificationStore.getState().getTabStatus('s1', 't1')).toBe('running')
  })

  it('clearTabStatus on completed removes the tab', () => {
    useNotificationStore.getState().handleHookEvent('s1', 't1', 'prompt')
    useNotificationStore.getState().handleHookEvent('s1', 't1', 'stop')
    useNotificationStore.getState().clearTabStatus('s1', 't1')
    expect(useNotificationStore.getState().getTabStatus('s1', 't1')).toBeNull()
  })

  it('clearTabStatus on running is a no-op', () => {
    useNotificationStore.getState().handleHookEvent('s1', 't1', 'prompt')
    useNotificationStore.getState().clearTabStatus('s1', 't1')
    expect(useNotificationStore.getState().getTabStatus('s1', 't1')).toBe('running')
  })
})

describe('notificationStore.getContextStatus rollup', () => {
  it('returns null for unknown contexts', () => {
    expect(useNotificationStore.getState().getContextStatus('nope')).toBeNull()
  })

  it('attention beats completed beats running', () => {
    const s = useNotificationStore.getState()
    s.handleHookEvent('s1', 'a', 'prompt')        // running
    s.handleHookEvent('s1', 'b', 'prompt')
    s.handleHookEvent('s1', 'b', 'stop')          // completed
    expect(s.getContextStatus('s1')).toBe('completed')
    s.handleHookEvent('s1', 'c', 'notification') // attention
    expect(s.getContextStatus('s1')).toBe('attention')
  })
})

describe('notificationStore.getNotificationCountForProject', () => {
  it('counts only attention/completed in the given project', () => {
    const s = useNotificationStore.getState()
    s.registerSessions([
      { id: 's-A', projectId: 'p1' },
      { id: 's-B', projectId: 'p1' },
      { id: 's-C', projectId: 'p2' },
    ])
    s.handleHookEvent('s-A', 't', 'notification') // attention
    s.handleHookEvent('s-B', 't', 'prompt')        // running (excluded)
    s.handleHookEvent('s-C', 't', 'prompt')
    s.handleHookEvent('s-C', 't', 'stop')          // completed but in p2
    expect(s.getNotificationCountForProject('p1')).toBe(1)
    expect(s.getNotificationCountForProject('p2')).toBe(1)
    expect(s.getNotificationCountForProject('nope')).toBe(0)
  })
})

describe('notificationStore badge sync', () => {
  it('updates the OS badge on transitions to attention/completed', () => {
    const s = useNotificationStore.getState()
    s.handleHookEvent('s1', 't', 'notification')
    expect(setBadge).toHaveBeenLastCalledWith(1)
    s.clearTabStatus('s1', 't')
    expect(setBadge).toHaveBeenLastCalledWith(0)
  })
})
