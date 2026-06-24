import { beforeEach, describe, expect, it, vi } from 'vitest'

// Drive node-pty + electron-store with light fakes so we can exercise the real
// terminal.service (spawnTerminal → killReviewLoopTerminals) without a PTY.
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

import { spawnTerminal, killReviewLoopTerminals } from '../../../src/main/services/terminal.service'

const fakeWindow = {
  isDestroyed: () => false,
  webContents: { send: vi.fn() },
} as unknown as Electron.BrowserWindow

beforeEach(() => {
  h.ptys = []
})

/** Spawn a shell-mode terminal on a given workspace tab (no claude command build). */
function spawn(sessionId: string, tabId: string): string {
  return spawnTerminal(fakeWindow, sessionId, '/wt', 'shell', 'dark', undefined, undefined, undefined, false, sessionId, tabId)
}

// terminal.service keeps a module-global `terminals` Map that persists across
// tests in this file, so each test uses a distinct session id to stay isolated.
describe('killReviewLoopTerminals', () => {
  it('kills only the review-loop-tabbed PTYs for the session and leaves the rest alive', () => {
    spawn('sess-1', 'review-loop:r1:review')
    spawn('sess-1', 'review-loop:r1:triage')
    spawn('sess-1', 'agent') // a normal session terminal — must survive

    const killed = killReviewLoopTerminals('sess-1')

    expect(killed).toBe(2)
    // ptys were created in spawn order: [review, triage, agent].
    expect(h.ptys[0].kill).toHaveBeenCalled()
    expect(h.ptys[1].kill).toHaveBeenCalled()
    expect(h.ptys[2].kill).not.toHaveBeenCalled()
  })

  it('does not touch another session’s review-loop terminals', () => {
    spawn('sess-2a', 'review-loop:r1:review')
    spawn('sess-2b', 'review-loop:r1:review')

    const killed = killReviewLoopTerminals('sess-2a')

    expect(killed).toBe(1)
    expect(h.ptys[0].kill).toHaveBeenCalled() // sess-2a
    expect(h.ptys[1].kill).not.toHaveBeenCalled() // sess-2b survives
  })

  it('returns 0 when the session has no review-loop terminals', () => {
    spawn('sess-3', 'agent')
    expect(killReviewLoopTerminals('sess-3')).toBe(0)
    expect(h.ptys[0].kill).not.toHaveBeenCalled()
  })
})
