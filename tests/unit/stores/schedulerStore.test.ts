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

describe('schedulerStore load edge cases', () => {
  it('load propagates IPC failures and never flips loaded', async () => {
    schedulerApi.listQueuedSessions.mockRejectedValue(new Error('ipc dead'))
    schedulerApi.listQueuedMessages.mockResolvedValue([])
    await expect(useSchedulerStore.getState().load()).rejects.toThrow('ipc dead')
    expect(useSchedulerStore.getState().loaded).toBe(false)
  })

  it('load with empty queues still marks the store loaded', async () => {
    schedulerApi.listQueuedSessions.mockResolvedValue([])
    schedulerApi.listQueuedMessages.mockResolvedValue([])
    await useSchedulerStore.getState().load()
    expect(useSchedulerStore.getState().queuedSessions).toEqual([])
    expect(useSchedulerStore.getState().queuedMessages).toEqual([])
    expect(useSchedulerStore.getState().loaded).toBe(true)
  })

  it('load hydrates sessions and messages independently of each other', async () => {
    const s = session({ id: 'only-session' })
    schedulerApi.listQueuedSessions.mockResolvedValue([s])
    schedulerApi.listQueuedMessages.mockResolvedValue([])
    await useSchedulerStore.getState().load()
    expect(useSchedulerStore.getState().queuedSessions).toEqual([s])
    expect(useSchedulerStore.getState().queuedMessages).toEqual([])
  })
})

describe('schedulerStore direct setters', () => {
  it('setQueuedSessions replaces the list without touching the IPC', () => {
    const s = session({ id: 'pushed' })
    useSchedulerStore.getState().setQueuedSessions([s])
    expect(useSchedulerStore.getState().queuedSessions).toEqual([s])
    expect(schedulerApi.listQueuedSessions).not.toHaveBeenCalled()
    expect(schedulerApi.addQueuedSession).not.toHaveBeenCalled()
  })

  it('setQueuedMessages replaces the list without touching the IPC', () => {
    const m = message({ id: 'pushed-m' })
    useSchedulerStore.getState().setQueuedMessages([m])
    expect(useSchedulerStore.getState().queuedMessages).toEqual([m])
    expect(schedulerApi.listQueuedMessages).not.toHaveBeenCalled()
  })

  it('setQueuedSessions can clear the queue with an empty list', () => {
    useSchedulerStore.setState({ queuedSessions: [session()] })
    useSchedulerStore.getState().setQueuedSessions([])
    expect(useSchedulerStore.getState().queuedSessions).toEqual([])
  })
})

describe('schedulerStore session mutations', () => {
  it('rescheduleQueuedSession forwards id and timestamp, storing the returned list', async () => {
    const later = Date.now() + 120_000
    const rescheduled = session({ id: 'qs1', scheduledFor: later })
    schedulerApi.rescheduleQueuedSession.mockResolvedValue([rescheduled])
    await useSchedulerStore.getState().rescheduleQueuedSession('qs1', later)
    expect(schedulerApi.rescheduleQueuedSession).toHaveBeenCalledWith('qs1', later)
    expect(useSchedulerStore.getState().queuedSessions).toEqual([rescheduled])
  })

  it('fireQueuedSessionNow invokes the IPC but does not mutate the local list', async () => {
    const pending = [session({ id: 'qs1' })]
    useSchedulerStore.setState({ queuedSessions: pending })
    schedulerApi.fireQueuedSessionNow.mockResolvedValue(undefined)
    await useSchedulerStore.getState().fireQueuedSessionNow('qs1')
    expect(schedulerApi.fireQueuedSessionNow).toHaveBeenCalledWith('qs1')
    // Main broadcasts the updated list separately; local state stays as-is.
    expect(useSchedulerStore.getState().queuedSessions).toEqual(pending)
  })

  it('fireQueuedSessionNow propagates IPC failures', async () => {
    schedulerApi.fireQueuedSessionNow.mockRejectedValue(new Error('already fired'))
    await expect(useSchedulerStore.getState().fireQueuedSessionNow('qs1')).rejects.toThrow(
      'already fired'
    )
  })

  it('addQueuedSession failure leaves the prior queue intact', async () => {
    const existing = [session({ id: 'keep' })]
    useSchedulerStore.setState({ queuedSessions: existing })
    schedulerApi.addQueuedSession.mockRejectedValue(new Error('quota'))
    await expect(
      useSchedulerStore.getState().addQueuedSession(session({ id: 'new' }))
    ).rejects.toThrow('quota')
    expect(useSchedulerStore.getState().queuedSessions).toEqual(existing)
  })
})

describe('schedulerStore message mutations', () => {
  it('addQueuedMessage forwards the item and replaces the local list', async () => {
    const m = message({ id: 'qm-new' })
    schedulerApi.addQueuedMessage.mockResolvedValue([m])
    await useSchedulerStore.getState().addQueuedMessage(m)
    expect(schedulerApi.addQueuedMessage).toHaveBeenCalledWith(m)
    expect(useSchedulerStore.getState().queuedMessages).toEqual([m])
  })

  it('cancelQueuedMessage replaces the list with the IPC result', async () => {
    useSchedulerStore.setState({ queuedMessages: [message({ id: 'qm1' }), message({ id: 'qm2' })] })
    const remaining = [message({ id: 'qm2' })]
    schedulerApi.cancelQueuedMessage.mockResolvedValue(remaining)
    await useSchedulerStore.getState().cancelQueuedMessage('qm1')
    expect(schedulerApi.cancelQueuedMessage).toHaveBeenCalledWith('qm1')
    expect(useSchedulerStore.getState().queuedMessages).toEqual(remaining)
  })

  it('getQueuedMessageForSession returns the first match when several are queued', () => {
    const first = message({ id: 'qm1', sessionId: 'dup' })
    const second = message({ id: 'qm2', sessionId: 'dup' })
    useSchedulerStore.setState({ queuedMessages: [first, second] })
    expect(useSchedulerStore.getState().getQueuedMessageForSession('dup')).toBe(first)
  })

  it('getQueuedMessageForSession returns undefined on an empty queue', () => {
    expect(useSchedulerStore.getState().getQueuedMessageForSession('s1')).toBeUndefined()
  })
})
