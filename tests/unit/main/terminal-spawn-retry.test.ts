import { describe, expect, it, vi } from 'vitest'

// node-pty has no prebuild on CI and terminal.service pulls in electron/etc at
// import — stub the heavy deps so we can import the pure spawnWithRetry helper.
vi.mock('node-pty', () => ({ spawn: () => ({ onData() {}, onExit() {}, write() {}, kill() {}, resize() {} }) }))
vi.mock('electron', () => ({ BrowserWindow: class {}, app: { getPath: () => '/tmp' } }))
vi.mock('electron-store', () => ({ default: class { get() { return {} } set() {} delete() {} } }))
vi.mock('../../../src/main/services/notification-server', () => ({
  handleHookEvent: () => {},
  findContextById: () => undefined,
  getNotificationServerPort: () => 0,
}))
vi.mock('../../../src/main/services/gh-shim.service', () => ({ ensureGhShimInstalled: () => '/tmp/shim' }))
vi.mock('../../../src/main/services/local-pr.service', () => ({ shouldCaptureContext: () => false }))

import { spawnWithRetry } from '../../../src/main/services/terminal.service'

const noSleep = () => {}

describe('spawnWithRetry', () => {
  it('returns immediately when the spawn succeeds', () => {
    const spawn = vi.fn(() => 'pty')
    expect(spawnWithRetry(spawn, 4, 0, noSleep)).toBe('pty')
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('retries transient posix_spawnp failures and eventually succeeds', () => {
    let n = 0
    const spawn = vi.fn(() => {
      n++
      if (n < 3) throw new Error('posix_spawnp failed.')
      return 'pty'
    })
    const slept: number[] = []
    const result = spawnWithRetry(spawn, 4, 80, (ms) => slept.push(ms))
    expect(result).toBe('pty')
    expect(spawn).toHaveBeenCalledTimes(3)
    expect(slept).toEqual([80, 160]) // backoff grows per attempt
  })

  it('gives up after exhausting retries and rethrows the last error', () => {
    const spawn = vi.fn(() => { throw new Error('posix_spawnp failed.') })
    expect(() => spawnWithRetry(spawn, 2, 0, noSleep)).toThrow('posix_spawnp failed')
    expect(spawn).toHaveBeenCalledTimes(3) // 1 initial + 2 retries
  })

  it('does NOT retry a non-transient error (fails fast)', () => {
    const spawn = vi.fn(() => { throw new Error('ENOENT: no such file or directory') })
    expect(() => spawnWithRetry(spawn, 4, 0, noSleep)).toThrow('ENOENT')
    expect(spawn).toHaveBeenCalledTimes(1)
  })
})
