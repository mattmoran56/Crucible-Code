import { afterEach, describe, expect, it, vi } from 'vitest'
import { eventBus, emitToRenderer } from '../../../src/main/services/event-bus'

type FakeWindow = {
  isDestroyed: () => boolean
  webContents: { send: ReturnType<typeof vi.fn> }
}

function makeWindow(destroyed = false): FakeWindow {
  return {
    isDestroyed: () => destroyed,
    webContents: { send: vi.fn() },
  }
}

afterEach(() => {
  // eventBus is process-wide module state — drop listeners between tests so
  // assertions can't bleed across cases.
  eventBus.removeAllListeners()
})

describe('event-bus', () => {
  it('emitToRenderer sends to the window webContents with the channel and args', () => {
    const win = makeWindow()
    emitToRenderer(win as never, 'chan:one', 'a', 1)
    expect(win.webContents.send).toHaveBeenCalledTimes(1)
    expect(win.webContents.send).toHaveBeenCalledWith('chan:one', 'a', 1)
  })

  it('emitToRenderer also emits the same event on the shared bus', () => {
    const win = makeWindow()
    const listener = vi.fn()
    eventBus.on('chan:two', listener)
    emitToRenderer(win as never, 'chan:two', { x: 1 }, 'y')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith({ x: 1 }, 'y')
  })

  it('skips webContents.send when the window is destroyed but still notifies the bus', () => {
    const win = makeWindow(true)
    const listener = vi.fn()
    eventBus.on('chan:destroyed', listener)
    emitToRenderer(win as never, 'chan:destroyed', 'payload')
    expect(win.webContents.send).not.toHaveBeenCalled()
    expect(listener).toHaveBeenCalledWith('payload')
  })

  it('handles a null window without throwing and still emits on the bus', () => {
    const listener = vi.fn()
    eventBus.on('chan:null', listener)
    expect(() => emitToRenderer(null, 'chan:null', 42)).not.toThrow()
    expect(listener).toHaveBeenCalledWith(42)
  })

  it('handles an undefined window without throwing', () => {
    const listener = vi.fn()
    eventBus.on('chan:undef', listener)
    expect(() => emitToRenderer(undefined, 'chan:undef')).not.toThrow()
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('passes zero-arg emits through to both sinks', () => {
    const win = makeWindow()
    const listener = vi.fn()
    eventBus.on('chan:empty', listener)
    emitToRenderer(win as never, 'chan:empty')
    expect(win.webContents.send).toHaveBeenCalledWith('chan:empty')
    expect(listener).toHaveBeenCalledWith()
  })

  it('is configured for up to 50 listeners (relay subscribes to every channel)', () => {
    expect(eventBus.getMaxListeners()).toBe(50)
  })

  it('bus subscribers on other channels are not invoked', () => {
    const win = makeWindow()
    const other = vi.fn()
    eventBus.on('chan:other', other)
    emitToRenderer(win as never, 'chan:actual', 'data')
    expect(other).not.toHaveBeenCalled()
  })
})
