import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useOverseerStore } from '@renderer/stores/overseerStore'
import type { OverseerSettings, OverseerState } from '@shared/types'

const settings: OverseerSettings = {
  apiKey: 'sk-ant-x',
  model: 'claude-haiku-4-5',
  heartbeatSeconds: 60,
  heartbeatEnabled: false,
  dailyCostCapUsd: 2,
  maxIterations: 12,
  allowWrites: false,
}

const state: OverseerState = {
  messages: [
    { id: 'm1', role: 'user', content: 'what is going on?', createdAt: '2026-01-01T09:00:00Z' },
    { id: 'm2', role: 'assistant', content: 'All quiet.', createdAt: '2026-01-01T09:00:01Z' },
  ],
  running: false,
  spendTodayUsd: 0.01,
  spendDay: '2026-01-01',
  unread: 1,
}

const api = {
  getState: vi.fn(async () => state),
  getSettings: vi.fn(async () => settings),
  setSettings: vi.fn(async (patch: Partial<OverseerSettings>) => ({ ...settings, ...patch })),
  send: vi.fn(async () => {}),
  cancel: vi.fn(async () => {}),
  clear: vi.fn(async () => {}),
  heartbeatNow: vi.fn(async () => {}),
  markRead: vi.fn(async () => {}),
  onStateUpdate: vi.fn(() => () => {}),
  onSessionsChanged: vi.fn(() => () => {}),
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(window as unknown as { api: unknown }).api = { overseer: api }
  useOverseerStore.setState({
    state: { messages: [], running: false, spendTodayUsd: 0, spendDay: '', unread: 0 },
    settings: null,
    loaded: false,
  })
})

describe('overseerStore', () => {
  it('loads state and settings together', async () => {
    await useOverseerStore.getState().load()
    const store = useOverseerStore.getState()
    expect(store.loaded).toBe(true)
    expect(store.settings).toEqual(settings)
    expect(store.state.messages).toHaveLength(2)
  })

  it('mirrors pushed state from main', () => {
    useOverseerStore.getState().applyState(state)
    expect(useOverseerStore.getState().state.spendTodayUsd).toBe(0.01)
  })

  it('sends a trimmed message', async () => {
    await useOverseerStore.getState().send('  what is going on?  ')
    expect(api.send).toHaveBeenCalledWith('what is going on?')
  })

  it('does not send whitespace', async () => {
    await useOverseerStore.getState().send('   ')
    expect(api.send).not.toHaveBeenCalled()
  })

  it('empties the thread optimistically on clear', async () => {
    useOverseerStore.getState().applyState(state)
    await useOverseerStore.getState().clear()
    expect(api.clear).toHaveBeenCalled()
    expect(useOverseerStore.getState().state.messages).toEqual([])
  })

  it('keeps the returned settings after a save', async () => {
    await useOverseerStore.getState().saveSettings({ model: 'claude-opus-5' })
    expect(api.setSettings).toHaveBeenCalledWith({ model: 'claude-opus-5' })
    expect(useOverseerStore.getState().settings?.model).toBe('claude-opus-5')
  })

  it('forwards cancel, heartbeatNow and markRead', async () => {
    await useOverseerStore.getState().cancel()
    await useOverseerStore.getState().heartbeatNow()
    await useOverseerStore.getState().markRead()
    expect(api.cancel).toHaveBeenCalled()
    expect(api.heartbeatNow).toHaveBeenCalled()
    expect(api.markRead).toHaveBeenCalled()
  })
})
