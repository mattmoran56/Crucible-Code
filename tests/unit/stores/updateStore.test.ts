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
