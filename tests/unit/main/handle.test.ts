import { describe, expect, it, vi } from 'vitest'

const ipcState = vi.hoisted(() => ({
  handleCalls: [] as Array<{ channel: string; fn: unknown }>,
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: unknown) => {
      ipcState.handleCalls.push({ channel, fn })
    },
  },
}))

import { handle, handlerMap, invokeHandler } from '../../../src/main/ipc/handle'

// handlerMap is module-level shared state — each test uses a unique channel
// name so registrations don't interfere.

describe('ipc/handle', () => {
  it('registers the handler in the shared map AND with ipcMain.handle', () => {
    const fn = vi.fn()
    handle('test:register', fn)
    expect(handlerMap.get('test:register')).toBe(fn)
    const ipcCall = ipcState.handleCalls.find((c) => c.channel === 'test:register')
    expect(ipcCall?.fn).toBe(fn)
  })

  it('invokeHandler calls the registered handler with an undefined event and spread args', async () => {
    const fn = vi.fn().mockReturnValue('result')
    handle('test:invoke-args', fn)
    const out = await invokeHandler('test:invoke-args', ['a', 2, { b: 3 }])
    expect(fn).toHaveBeenCalledWith(undefined, 'a', 2, { b: 3 })
    expect(out).toBe('result')
  })

  it('invokeHandler awaits async handlers and returns the resolved value', async () => {
    handle('test:async', async (_evt, x: number) => x * 2)
    await expect(invokeHandler('test:async', [21])).resolves.toBe(42)
  })

  it('invokeHandler rejects for a channel that was never registered', async () => {
    await expect(invokeHandler('test:missing-channel', [])).rejects.toThrow(
      'No handler registered for channel: test:missing-channel'
    )
  })

  it('invokeHandler propagates handler rejections to the caller', async () => {
    handle('test:throws', async () => {
      throw new Error('boom')
    })
    await expect(invokeHandler('test:throws', [])).rejects.toThrow('boom')
  })

  it('re-registering a channel replaces the previous handler (latest wins)', async () => {
    const first = vi.fn().mockReturnValue('first')
    const second = vi.fn().mockReturnValue('second')
    handle('test:replace', first)
    handle('test:replace', second)
    await expect(invokeHandler('test:replace', [])).resolves.toBe('second')
    expect(first).not.toHaveBeenCalled()
  })

  it('invokeHandler with an empty args array calls the handler with only the undefined event', async () => {
    const fn = vi.fn().mockReturnValue(null)
    handle('test:no-args', fn)
    await invokeHandler('test:no-args', [])
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn.mock.calls[0]).toEqual([undefined])
  })
})
