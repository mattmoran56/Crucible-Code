import { beforeEach, describe, expect, it, vi } from 'vitest'

// Drive node-pty + electron-store with light fakes so we can exercise the real
// terminal.service watchers (used by the cloud create flow) without a PTY.
const h = vi.hoisted(() => {
  const s: any = { ptys: [] }
  s.makePty = () => {
    const p: any = {
      pid: 1000 + s.ptys.length,
      onData: vi.fn(),
      onExit: vi.fn(),
      resize: vi.fn(),
      write: vi.fn(),
      kill: vi.fn(),
    }
    s.ptys.push(p)
    return p
  }
  return s
})

vi.mock('node-pty', () => ({
  spawn: () => h.makePty(),
}))
vi.mock('electron', () => ({ BrowserWindow: class {} }))
vi.mock('electron-store', () => ({
  default: class {
    store: Record<string, unknown> = {}
    get(_k: string, d?: unknown) {
      return d ?? {}
    }
    set() {}
    delete() {}
  },
}))
vi.mock('../../../src/main/store-path', () => ({ getStorePath: () => '/tmp/crucible-test' }))
vi.mock('../../../src/main/services/notification-server', () => ({
  handleHookEvent: vi.fn(),
  findContextById: vi.fn(() => null),
}))
vi.mock('../../../src/main/services/usage.service', () => ({ getSessionUsage: vi.fn(() => null) }))

import { killTerminal, spawnTerminal, watchTerminal } from '../../../src/main/services/terminal.service'

const fakeWindow = {
  isDestroyed: () => false,
  webContents: { send: vi.fn() },
} as unknown as Electron.BrowserWindow

beforeEach(() => {
  h.ptys = []
})

const spawnCommand = (sessionId: string) =>
  spawnTerminal(fakeWindow, sessionId, '/wt', 'command', 'dark', undefined, 'claude --cloud go', undefined, false, sessionId, 'agent')

describe('watchTerminal', () => {
  it('sees every output chunk, then the exit, once', () => {
    const id = spawnCommand('watch-1')
    const pty = h.ptys[0]
    const data: string[] = []
    const exits: number[] = []
    watchTerminal(id, { onData: (d) => data.push(d), onExit: (c) => exits.push(c) })
    const onData = pty.onData.mock.calls[0][0]
    const onExit = pty.onExit.mock.calls[0][0]
    onData('Setting up remote session…')
    onData('https://claude.ai/code/session_01x')
    onExit({ exitCode: 0 })
    onExit({ exitCode: 0 })
    expect(data).toEqual(['Setting up remote session…', 'https://claude.ai/code/session_01x'])
    expect(exits).toEqual([0])
  })

  it('stops after unwatch, and reports an intentional kill as an exit', () => {
    const id = spawnCommand('watch-2')
    const pty = h.ptys[0]
    const seen: string[] = []
    const off = watchTerminal(id, { onData: (d) => seen.push(d) })
    off()
    pty.onData.mock.calls[0][0]('ignored')
    expect(seen).toEqual([])

    const exits: number[] = []
    watchTerminal(id, { onExit: (c) => exits.push(c) })
    killTerminal(id)
    pty.onExit.mock.calls[0][0]({ exitCode: 143 })
    expect(exits).toEqual([143])
  })

  it('a throwing watcher does not break the PTY', () => {
    const id = spawnCommand('watch-3')
    watchTerminal(id, { onData: () => { throw new Error('boom') } })
    expect(() => h.ptys[0].onData.mock.calls[0][0]('x')).not.toThrow()
  })
})
