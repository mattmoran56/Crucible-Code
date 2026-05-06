import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSchedulerStore } from '../../../src/renderer/stores/schedulerStore'
import type { QueuedSession, QueuedMessage } from '../../../src/shared/types'

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

const schedulerApi = {
  listQueuedSessions: vi.fn(),
  addQueuedSession: vi.fn(),
  cancelQueuedSession: vi.fn(),
  rescheduleQueuedSession: vi.fn(),
  fireQueuedSessionNow: vi.fn(),
  onQueuedSessionsUpdate: vi.fn().mockReturnValue(() => {}),
  onFireQueuedSession: vi.fn().mockReturnValue(() => {}),
  listQueuedMessages: vi.fn(),
  addQueuedMessage: vi.fn(),
  cancelQueuedMessage: vi.fn(),
  onQueuedMessagesUpdate: vi.fn().mockReturnValue(() => {}),
  onFireQueuedMessage: vi.fn().mockReturnValue(() => {}),
}

beforeEach(() => {
  for (const fn of Object.values(schedulerApi)) {
    if (typeof fn === 'function' && 'mockReset' in fn) (fn as any).mockReset()
  }
  schedulerApi.onQueuedSessionsUpdate.mockReturnValue(() => {})
  schedulerApi.onFireQueuedSession.mockReturnValue(() => {})
  schedulerApi.onQueuedMessagesUpdate.mockReturnValue(() => {})
  schedulerApi.onFireQueuedMessage.mockReturnValue(() => {})
  ;(window as any).api = { scheduler: schedulerApi }
  useSchedulerStore.setState({ queuedSessions: [], queuedMessages: [], loaded: false })
})

describe('schedulerStore', () => {
  it('hydrates queued sessions and messages from the main process on load', async () => {
    const s = session()
    const m = message()
    schedulerApi.listQueuedSessions.mockResolvedValue([s])
    schedulerApi.listQueuedMessages.mockResolvedValue([m])

    await useSchedulerStore.getState().load()

    expect(useSchedulerStore.getState().queuedSessions).toEqual([s])
    expect(useSchedulerStore.getState().queuedMessages).toEqual([m])
    expect(useSchedulerStore.getState().loaded).toBe(true)
  })

  it('addQueuedSession round-trips through the IPC and updates local state', async () => {
    const s = session()
    schedulerApi.addQueuedSession.mockResolvedValue([s])
    await useSchedulerStore.getState().addQueuedSession(s)
    expect(schedulerApi.addQueuedSession).toHaveBeenCalledWith(s)
    expect(useSchedulerStore.getState().queuedSessions).toEqual([s])
  })

  it('cancelQueuedSession replaces local state with the IPC-returned list', async () => {
    schedulerApi.cancelQueuedSession.mockResolvedValue([])
    useSchedulerStore.setState({ queuedSessions: [session()] })
    await useSchedulerStore.getState().cancelQueuedSession('qs1')
    expect(useSchedulerStore.getState().queuedSessions).toEqual([])
  })

  it('getQueuedMessageForSession looks up by sessionId', () => {
    const m = message({ sessionId: 'target' })
    useSchedulerStore.setState({ queuedMessages: [m] })
    expect(useSchedulerStore.getState().getQueuedMessageForSession('target')).toBe(m)
    expect(useSchedulerStore.getState().getQueuedMessageForSession('other')).toBeUndefined()
  })
})
