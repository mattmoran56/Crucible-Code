import { beforeEach, describe, expect, it } from 'vitest'
import { useUpdateStore } from '../../../src/renderer/stores/updateStore'

beforeEach(() => {
  useUpdateStore.getState().reset()
})

describe('updateStore', () => {
  it('starts in the idle state with an empty log', () => {
    expect(useUpdateStore.getState().status).toEqual({ state: 'idle' })
    expect(useUpdateStore.getState().log).toEqual([])
  })

  it('setStatus replaces the current status object', () => {
    useUpdateStore.getState().setStatus({ state: 'updating' } as any)
    expect(useUpdateStore.getState().status).toEqual({ state: 'updating' })
    useUpdateStore.getState().setStatus({ state: 'error', message: 'boom' } as any)
    expect(useUpdateStore.getState().status).toEqual({ state: 'error', message: 'boom' })
  })

  it('appendLog appends in order without mutating prior entries', () => {
    useUpdateStore.getState().appendLog('a')
    useUpdateStore.getState().appendLog('b')
    useUpdateStore.getState().appendLog('c')
    expect(useUpdateStore.getState().log).toEqual(['a', 'b', 'c'])
  })

  it('reset returns to initial state', () => {
    useUpdateStore.getState().setStatus({ state: 'updating' } as any)
    useUpdateStore.getState().appendLog('something')
    useUpdateStore.getState().reset()
    expect(useUpdateStore.getState().status).toEqual({ state: 'idle' })
    expect(useUpdateStore.getState().log).toEqual([])
  })
})

describe('updateStore status payloads', () => {
  it('setStatus carries optional metadata fields untouched', () => {
    useUpdateStore.getState().setStatus({
      state: 'available',
      commitCount: 12,
      builtCommit: 'abc123',
    })
    expect(useUpdateStore.getState().status).toEqual({
      state: 'available',
      commitCount: 12,
      builtCommit: 'abc123',
    })
  })

  it('a later setStatus drops fields the new payload omits', () => {
    useUpdateStore.getState().setStatus({ state: 'error', error: 'build failed' })
    useUpdateStore.getState().setStatus({ state: 'idle' })
    expect(useUpdateStore.getState().status).toEqual({ state: 'idle' })
    expect((useUpdateStore.getState().status as any).error).toBeUndefined()
  })

  it('walks the full idle → available → updating → idle lifecycle', () => {
    expect(useUpdateStore.getState().status.state).toBe('idle')
    useUpdateStore.getState().setStatus({ state: 'available', commitCount: 3 })
    expect(useUpdateStore.getState().status.state).toBe('available')
    useUpdateStore.getState().setStatus({ state: 'updating' })
    expect(useUpdateStore.getState().status.state).toBe('updating')
    useUpdateStore.getState().setStatus({ state: 'idle' })
    expect(useUpdateStore.getState().status.state).toBe('idle')
  })

  it('setStatus does not clear the accumulated log', () => {
    useUpdateStore.getState().appendLog('pulling')
    useUpdateStore.getState().setStatus({ state: 'updating' })
    expect(useUpdateStore.getState().log).toEqual(['pulling'])
  })
})

describe('updateStore log handling', () => {
  it('appendLog does not alter the current status', () => {
    useUpdateStore.getState().setStatus({ state: 'updating' })
    useUpdateStore.getState().appendLog('compiling')
    expect(useUpdateStore.getState().status).toEqual({ state: 'updating' })
  })

  it('appendLog produces a new array instead of mutating the previous one', () => {
    const before = useUpdateStore.getState().log
    useUpdateStore.getState().appendLog('first line')
    expect(before).toEqual([])
    expect(useUpdateStore.getState().log).not.toBe(before)
  })

  it('appendLog keeps duplicate lines as separate entries', () => {
    useUpdateStore.getState().appendLog('warn: x')
    useUpdateStore.getState().appendLog('warn: x')
    expect(useUpdateStore.getState().log).toEqual(['warn: x', 'warn: x'])
  })

  it('appendLog stores empty strings rather than skipping them', () => {
    useUpdateStore.getState().appendLog('')
    useUpdateStore.getState().appendLog('after blank')
    expect(useUpdateStore.getState().log).toEqual(['', 'after blank'])
  })

  it('logging restarts cleanly after a reset', () => {
    useUpdateStore.getState().appendLog('old run')
    useUpdateStore.getState().reset()
    useUpdateStore.getState().appendLog('new run')
    expect(useUpdateStore.getState().log).toEqual(['new run'])
  })

  it('reset is idempotent when called repeatedly', () => {
    useUpdateStore.getState().reset()
    useUpdateStore.getState().reset()
    expect(useUpdateStore.getState().status).toEqual({ state: 'idle' })
    expect(useUpdateStore.getState().log).toEqual([])
  })
})
