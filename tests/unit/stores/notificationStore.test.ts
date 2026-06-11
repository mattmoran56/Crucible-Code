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

describe('notificationStore.handleHookEvent transitions (extended)', () => {
  it('stop on a fresh tab with no prior status → completed', () => {
    useNotificationStore.getState().handleHookEvent('s1', 't1', 'stop')
    expect(useNotificationStore.getState().getTabStatus('s1', 't1')).toBe('completed')
  })

  it('notification overrides a running tab', () => {
    useNotificationStore.getState().handleHookEvent('s1', 't1', 'prompt')
    useNotificationStore.getState().handleHookEvent('s1', 't1', 'notification')
    expect(useNotificationStore.getState().getTabStatus('s1', 't1')).toBe('attention')
  })

  it('notification overrides a completed tab', () => {
    useNotificationStore.getState().handleHookEvent('s1', 't1', 'stop')
    useNotificationStore.getState().handleHookEvent('s1', 't1', 'notification')
    expect(useNotificationStore.getState().getTabStatus('s1', 't1')).toBe('attention')
  })

  it('prompt restarts a completed tab as running', () => {
    useNotificationStore.getState().handleHookEvent('s1', 't1', 'stop')
    useNotificationStore.getState().handleHookEvent('s1', 't1', 'prompt')
    expect(useNotificationStore.getState().getTabStatus('s1', 't1')).toBe('running')
  })

  it('prompt clears the deferred-stop flag so a later stop completes immediately', () => {
    const s = useNotificationStore.getState()
    s.handleHookEvent('s1', 't1', 'notification')
    s.handleHookEvent('s1', 't1', 'stop') // deferred — stays attention
    s.handleHookEvent('s1', 't1', 'prompt') // user re-engaged → flag cleared
    expect(useNotificationStore.getState().getTabStatus('s1', 't1')).toBe('running')
    expect(useNotificationStore.getState().stoppedWhileAttention.size).toBe(0)
    s.handleHookEvent('s1', 't1', 'stop')
    expect(useNotificationStore.getState().getTabStatus('s1', 't1')).toBe('completed')
  })

  it('stop while attention only records the deferred flag and does not touch the badge', () => {
    useNotificationStore.getState().handleHookEvent('s1', 't1', 'notification')
    setBadge.mockClear()
    useNotificationStore.getState().handleHookEvent('s1', 't1', 'stop')
    expect(setBadge).not.toHaveBeenCalled()
    expect(useNotificationStore.getState().stoppedWhileAttention.has('s1|t1')).toBe(true)
  })

  it('tracks tab statuses independently within one context', () => {
    const s = useNotificationStore.getState()
    s.handleHookEvent('s1', 'a', 'prompt')
    s.handleHookEvent('s1', 'b', 'notification')
    expect(s.getTabStatus('s1', 'a')).toBe('running')
    expect(s.getTabStatus('s1', 'b')).toBe('attention')
  })

  it('getTabStatus returns null for an unknown tab in a known context', () => {
    useNotificationStore.getState().handleHookEvent('s1', 't1', 'prompt')
    expect(useNotificationStore.getState().getTabStatus('s1', 'other')).toBeNull()
  })
})

describe('notificationStore.clearTabStatus (extended)', () => {
  it('is a no-op for an unknown context (no badge sync)', () => {
    useNotificationStore.getState().clearTabStatus('nope', 't1')
    expect(setBadge).not.toHaveBeenCalled()
  })

  it('is a no-op for an unknown tab inside a known context', () => {
    useNotificationStore.getState().handleHookEvent('s1', 't1', 'prompt')
    setBadge.mockClear()
    useNotificationStore.getState().clearTabStatus('s1', 'unknown-tab')
    expect(setBadge).not.toHaveBeenCalled()
    expect(useNotificationStore.getState().getTabStatus('s1', 't1')).toBe('running')
  })

  it('removes the whole context entry once its last tab is cleared', () => {
    useNotificationStore.getState().handleHookEvent('s1', 't1', 'stop')
    useNotificationStore.getState().clearTabStatus('s1', 't1')
    expect(useNotificationStore.getState().contextStatuses.has('s1')).toBe(false)
  })
})

describe('notificationStore.clearContextStatuses', () => {
  it('is a no-op for an unknown context', () => {
    useNotificationStore.getState().clearContextStatuses('nope')
    expect(setBadge).not.toHaveBeenCalled()
  })

  it('clears completed tabs, reverts plain attention to running, leaves running alone', () => {
    const s = useNotificationStore.getState()
    s.handleHookEvent('s1', 'run', 'prompt')        // running
    s.handleHookEvent('s1', 'done', 'stop')         // completed
    s.handleHookEvent('s1', 'attn', 'notification') // attention (no deferred stop)
    s.clearContextStatuses('s1')
    const after = useNotificationStore.getState()
    expect(after.getTabStatus('s1', 'run')).toBe('running')
    expect(after.getTabStatus('s1', 'done')).toBeNull()
    expect(after.getTabStatus('s1', 'attn')).toBe('running')
  })

  it('fully removes attention tabs that had a deferred stop', () => {
    const s = useNotificationStore.getState()
    s.handleHookEvent('s1', 't1', 'notification')
    s.handleHookEvent('s1', 't1', 'stop') // deferred
    s.clearContextStatuses('s1')
    const after = useNotificationStore.getState()
    expect(after.getTabStatus('s1', 't1')).toBeNull()
    expect(after.contextStatuses.has('s1')).toBe(false)
    expect(after.stoppedWhileAttention.size).toBe(0)
  })

  it('syncs the badge after clearing', () => {
    useNotificationStore.getState().handleHookEvent('s1', 't1', 'stop')
    expect(setBadge).toHaveBeenLastCalledWith(1)
    useNotificationStore.getState().clearContextStatuses('s1')
    expect(setBadge).toHaveBeenLastCalledWith(0)
  })
})

describe('notificationStore rollup & badge counting (extended)', () => {
  it('rolls up to running when every tab is running', () => {
    const s = useNotificationStore.getState()
    s.handleHookEvent('s1', 'a', 'prompt')
    s.handleHookEvent('s1', 'b', 'prompt')
    expect(s.getContextStatus('s1')).toBe('running')
  })

  it('counts contexts (not tabs) toward the badge', () => {
    const s = useNotificationStore.getState()
    s.handleHookEvent('s1', 'a', 'notification')
    s.handleHookEvent('s1', 'b', 'notification')
    expect(setBadge).toHaveBeenLastCalledWith(1)
    s.handleHookEvent('s2', 'a', 'stop')
    expect(setBadge).toHaveBeenLastCalledWith(2)
  })

  it('does not count contexts whose rollup is running', () => {
    const s = useNotificationStore.getState()
    s.handleHookEvent('s1', 'a', 'prompt')
    expect(setBadge).toHaveBeenLastCalledWith(0)
  })

  it('registerSessions merges new entries without dropping previous ones', () => {
    const s = useNotificationStore.getState()
    s.registerSessions([{ id: 's1', projectId: 'p1' }])
    s.registerSessions([{ id: 's2', projectId: 'p2' }])
    const map = useNotificationStore.getState().sessionProjectMap
    expect(map.get('s1')).toBe('p1')
    expect(map.get('s2')).toBe('p2')
  })

  it('registerSessions overwrites the projectId for an existing session id', () => {
    const s = useNotificationStore.getState()
    s.registerSessions([{ id: 's1', projectId: 'p1' }])
    s.registerSessions([{ id: 's1', projectId: 'p2' }])
    expect(useNotificationStore.getState().sessionProjectMap.get('s1')).toBe('p2')
  })

  it('getNotificationCountForProject ignores contexts with no project mapping', () => {
    const s = useNotificationStore.getState()
    s.handleHookEvent('unmapped', 't', 'notification')
    expect(s.getNotificationCountForProject('p1')).toBe(0)
  })
})
