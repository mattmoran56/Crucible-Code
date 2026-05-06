import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueuedSession, QueuedMessage } from '../../../src/shared/types'

// In-memory replacement for electron-store. The real lib persists JSON to disk,
// which we don't want in unit tests. We provide a class with the same minimal
// surface the scheduler uses: get(key, default), set(key, value).
const sentMessages: Array<{ channel: string; payload: unknown }> = []

const fakeWindow = {
  webContents: {
    send: (channel: string, payload: unknown) => {
      sentMessages.push({ channel, payload })
    },
  },
} as unknown as Electron.BrowserWindow

class FakeStore<T extends Record<string, unknown>> {
  private state: T
  constructor(opts: { defaults: T }) {
    this.state = JSON.parse(JSON.stringify(opts.defaults))
  }
  get<K extends keyof T>(key: K, defaultValue?: T[K]): T[K] {
    return (this.state[key] ?? defaultValue) as T[K]
  }
  set<K extends keyof T>(key: K, value: T[K]): void {
    this.state[key] = value
  }
}

vi.mock('electron-store', () => ({ default: FakeStore }))
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/codecrucible-test', isPackaged: false },
}))
vi.mock('../../../src/main/store-path', () => ({ getStorePath: () => '/tmp/codecrucible-test' }))

const session = (overrides: Partial<QueuedSession> = {}): QueuedSession => ({
  id: 'qs1',
  projectId: 'p1',
  name: 'feat/x',
  startupPrompt: 'do the thing',
  scheduledFor: Date.now() + 60_000,
  createdAt: '2026-01-01T00:00:00Z',
  ...overrides,
})

const message = (overrides: Partial<QueuedMessage> = {}): QueuedMessage => ({
  id: 'qm1',
  sessionId: 's1',
  message: 'continue',
  scheduledFor: Date.now() + 60_000,
  createdAt: '2026-01-01T00:00:00Z',
  reason: 'usage-reset',
  ...overrides,
})

beforeEach(() => {
  sentMessages.length = 0
  vi.resetModules()
  vi.useFakeTimers({ shouldAdvanceTime: false })
  // Anchor the fake clock so `Date.now()` is stable across tests.
  vi.setSystemTime(new Date('2026-05-05T12:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

async function loadFresh() {
  return await import('../../../src/main/services/scheduler.service')
}

describe('scheduler.service — queued sessions', () => {
  it('persists, fires after the delay, and broadcasts on the fire channel', async () => {
    const scheduler = await loadFresh()
    scheduler.startScheduler(fakeWindow)

    const item = session({ scheduledFor: Date.now() + 5_000 })
    scheduler.addQueuedSession(item)

    expect(scheduler.listQueuedSessions()).toHaveLength(1)
    expect(sentMessages.find((m) => m.channel === 'scheduler:queued-sessions-update')).toBeDefined()

    // Just before — should not have fired
    vi.advanceTimersByTime(4_999)
    expect(sentMessages.find((m) => m.channel === 'scheduler:fire-queued-session')).toBeUndefined()

    // Cross the threshold
    vi.advanceTimersByTime(2)
    const fire = sentMessages.find((m) => m.channel === 'scheduler:fire-queued-session')
    expect(fire?.payload).toMatchObject({ id: 'qs1', name: 'feat/x' })
    expect(scheduler.listQueuedSessions()).toHaveLength(0)
  })

  it('cancel removes the entry and never fires it', async () => {
    const scheduler = await loadFresh()
    scheduler.startScheduler(fakeWindow)
    scheduler.addQueuedSession(session({ scheduledFor: Date.now() + 5_000 }))

    scheduler.cancelQueuedSession('qs1')
    expect(scheduler.listQueuedSessions()).toHaveLength(0)

    vi.advanceTimersByTime(10_000)
    expect(sentMessages.find((m) => m.channel === 'scheduler:fire-queued-session')).toBeUndefined()
  })

  it('reschedule moves the fire time and the old timer never runs', async () => {
    const scheduler = await loadFresh()
    scheduler.startScheduler(fakeWindow)
    scheduler.addQueuedSession(session({ scheduledFor: Date.now() + 5_000 }))

    // Push it 10 seconds further out
    scheduler.rescheduleQueuedSession('qs1', Date.now() + 15_000)

    // Original fire window — shouldn't fire
    vi.advanceTimersByTime(6_000)
    expect(sentMessages.find((m) => m.channel === 'scheduler:fire-queued-session')).toBeUndefined()

    // New fire window
    vi.advanceTimersByTime(10_000)
    expect(sentMessages.find((m) => m.channel === 'scheduler:fire-queued-session')).toBeDefined()
  })

  it('fireQueuedSessionNow fires immediately, regardless of scheduledFor', async () => {
    const scheduler = await loadFresh()
    scheduler.startScheduler(fakeWindow)
    scheduler.addQueuedSession(session({ scheduledFor: Date.now() + 60_000 }))

    scheduler.fireQueuedSessionNow('qs1')

    expect(sentMessages.find((m) => m.channel === 'scheduler:fire-queued-session')).toBeDefined()
    expect(scheduler.listQueuedSessions()).toHaveLength(0)
  })

  it('fires past-due items on rehydrate after a renderer-ready buffer', async () => {
    // Pre-seed the persisted state by calling addQueuedSession before "restart"
    const scheduler1 = await loadFresh()
    scheduler1.startScheduler(fakeWindow)
    scheduler1.addQueuedSession(session({ scheduledFor: Date.now() + 5_000 }))
    scheduler1.stopScheduler()

    // Advance the clock past the scheduledFor — simulates the user closing
    // the app and reopening after the fire time.
    vi.advanceTimersByTime(10_000)
    sentMessages.length = 0

    // startScheduler re-reads the persisted list and re-arms timers. For
    // past-due items it uses a renderer-ready buffer (~2.5s) so the
    // renderer's IPC subscriber has time to register before we send the
    // fire event.
    scheduler1.startScheduler(fakeWindow)
    // Just under the buffer — should not fire yet
    vi.advanceTimersByTime(1_000)
    expect(sentMessages.find((m) => m.channel === 'scheduler:fire-queued-session')).toBeUndefined()
    // After the buffer — should fire
    vi.advanceTimersByTime(2_500)
    expect(sentMessages.find((m) => m.channel === 'scheduler:fire-queued-session')).toBeDefined()
  })
})

describe('scheduler.service — queued messages', () => {
  it('dedupes by sessionId — adding a second message replaces the first', async () => {
    const scheduler = await loadFresh()
    scheduler.startScheduler(fakeWindow)

    scheduler.addQueuedMessage(message({ id: 'qm1', message: 'first', scheduledFor: Date.now() + 60_000 }))
    scheduler.addQueuedMessage(message({ id: 'qm2', message: 'second', scheduledFor: Date.now() + 60_000 }))

    const list = scheduler.listQueuedMessages()
    expect(list).toHaveLength(1)
    expect(list[0].message).toBe('second')

    // Original timer for qm1 must not fire — only qm2 should
    vi.advanceTimersByTime(60_000 + 1)
    const fires = sentMessages.filter((m) => m.channel === 'scheduler:fire-queued-message')
    expect(fires).toHaveLength(1)
    expect(fires[0].payload).toMatchObject({ id: 'qm2', message: 'second' })
  })

  it('cancelQueuedMessage cancels the timer', async () => {
    const scheduler = await loadFresh()
    scheduler.startScheduler(fakeWindow)
    scheduler.addQueuedMessage(message({ scheduledFor: Date.now() + 5_000 }))

    scheduler.cancelQueuedMessage('qm1')
    vi.advanceTimersByTime(10_000)
    expect(sentMessages.find((m) => m.channel === 'scheduler:fire-queued-message')).toBeUndefined()
  })
})
