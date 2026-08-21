import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OverseerPanel } from '../../../../src/renderer/components/overseer/OverseerPanel'
import { useOverseerStore } from '../../../../src/renderer/stores/overseerStore'
import type { OverseerMessage, OverseerSettings, OverseerState } from '../../../../src/shared/types'

const baseSettings: OverseerSettings = {
  apiKey: 'sk-ant-x',
  model: 'claude-haiku-4-5',
  heartbeatSeconds: 60,
  heartbeatEnabled: false,
  dailyCostCapUsd: 2,
  maxIterations: 12,
  allowWrites: false,
}

const api = {
  getState: vi.fn(),
  getSettings: vi.fn(),
  setSettings: vi.fn(async (p: Partial<OverseerSettings>) => ({ ...baseSettings, ...p })),
  send: vi.fn(async () => {}),
  cancel: vi.fn(async () => {}),
  clear: vi.fn(async () => {}),
  heartbeatNow: vi.fn(async () => {}),
  markRead: vi.fn(async () => {}),
  onStateUpdate: vi.fn(() => () => {}),
  onSessionsChanged: vi.fn(() => () => {}),
}

function msg(over: Partial<OverseerMessage> & { role: OverseerMessage['role'] }): OverseerMessage {
  return { id: Math.random().toString(36), content: '', createdAt: '2026-01-01T09:00:00Z', ...over }
}

function mount(
  messages: OverseerMessage[] = [],
  stateOver: Partial<OverseerState> = {},
  settingsOver: Partial<OverseerSettings> = {}
) {
  useOverseerStore.setState({
    state: {
      messages,
      running: false,
      spendTodayUsd: 0.014,
      spendDay: '2026-01-01',
      unread: 0,
      ...stateOver,
    },
    settings: { ...baseSettings, ...settingsOver },
    loaded: true,
  })
  return render(<OverseerPanel />)
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(window as unknown as { api: unknown }).api = { overseer: api }
})

describe('OverseerPanel', () => {
  it('offers starter prompts when the thread is empty', async () => {
    mount([])
    const suggestion = screen.getByRole('button', { name: /table of all sessions/i })
    await userEvent.click(suggestion)
    expect(api.send).toHaveBeenCalledWith(
      expect.stringContaining('table of all sessions')
    )
  })

  it('renders the conversation with speaker labels', () => {
    mount([
      msg({ role: 'user', content: 'what is going on?' }),
      msg({ role: 'assistant', content: 'All quiet.' }),
    ])
    expect(screen.getByText('You')).toBeInTheDocument()
    expect(screen.getByText('Overseer')).toBeInTheDocument()
    expect(screen.getByText('All quiet.')).toBeInTheDocument()
  })

  it('renders an assistant markdown table', () => {
    mount([msg({ role: 'assistant', content: '| Session | Status |\n|---|---|\n| auth | busy |' })])
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByText('auth')).toBeInTheDocument()
  })

  it('labels heartbeat messages and flags the ones needing you', () => {
    mount([
      msg({
        role: 'assistant',
        content: 'flaky-e2e is blocked.',
        fromHeartbeat: true,
        needsAttention: true,
      }),
    ])
    expect(screen.getByText('heartbeat')).toBeInTheDocument()
    expect(screen.getByText('needs you')).toBeInTheDocument()
  })

  it('shows tool activity as a compact trail, not a bubble', () => {
    mount([msg({ role: 'tool', content: 'Listed all sessions', toolName: 'list_sessions', toolOk: true })])
    expect(screen.getByText('Listed all sessions')).toBeInTheDocument()
    expect(screen.queryByText('Overseer')).not.toBeInTheDocument()
  })

  it('sends the draft on Enter and clears the box', async () => {
    mount([])
    const box = screen.getByLabelText('Message the Overseer')
    await userEvent.type(box, 'what is blocked?{Enter}')
    expect(api.send).toHaveBeenCalledWith('what is blocked?')
    expect(box).toHaveValue('')
  })

  it('keeps Shift+Enter as a newline', async () => {
    mount([])
    const box = screen.getByLabelText('Message the Overseer')
    await userEvent.type(box, 'line one{Shift>}{Enter}{/Shift}line two')
    expect(api.send).not.toHaveBeenCalled()
    expect(box).toHaveValue('line one\nline two')
  })

  it('will not send while a pass is running', async () => {
    mount([], { running: true })
    const box = screen.getByLabelText('Message the Overseer')
    await userEvent.type(box, 'hello{Enter}')
    expect(api.send).not.toHaveBeenCalled()
  })

  it('offers a stop control mid-pass', async () => {
    mount([], { running: true })
    await userEvent.click(screen.getByRole('button', { name: 'stop' }))
    expect(api.cancel).toHaveBeenCalled()
  })

  it('switches model from the header — the main cost lever', async () => {
    mount([])
    await userEvent.selectOptions(screen.getByLabelText('Overseer model'), 'claude-opus-5')
    expect(api.setSettings).toHaveBeenCalledWith({ model: 'claude-opus-5' })
  })

  it('defaults the model picker to the cheapest option', () => {
    mount([])
    expect(screen.getByLabelText('Overseer model')).toHaveValue('claude-haiku-4-5')
  })

  it('toggles the heartbeat', async () => {
    mount([])
    await userEvent.click(screen.getByLabelText(/heartbeat$/i))
    expect(api.setSettings).toHaveBeenCalledWith({ heartbeatEnabled: true })
  })

  it('toggles writes, which are off by default', async () => {
    mount([])
    const writes = screen.getByLabelText(/writes/i)
    expect(writes).not.toBeChecked()
    await userEvent.click(writes)
    expect(api.setSettings).toHaveBeenCalledWith({ allowWrites: true })
  })

  it('runs a check on demand', async () => {
    mount([])
    await userEvent.click(screen.getByRole('button', { name: 'Check now' }))
    expect(api.heartbeatNow).toHaveBeenCalled()
  })

  it('disables the on-demand check while a pass is running', () => {
    mount([], { running: true })
    expect(screen.getByRole('button', { name: 'Check now' })).toBeDisabled()
  })

  it('shows the running spend', () => {
    mount([], { spendTodayUsd: 0.1234 })
    expect(screen.getByText('$0.123')).toBeInTheDocument()
  })

  it('warns when no API key is set', () => {
    mount([], {}, { apiKey: '' })
    expect(screen.getByText(/no api key set/i)).toBeInTheDocument()
  })

  it('warns when the daily cap is reached', () => {
    mount([], { spendTodayUsd: 5 }, { dailyCostCapUsd: 2 })
    expect(screen.getByText(/daily cost cap reached/i)).toBeInTheDocument()
  })

  it('surfaces the last error', () => {
    mount([], { lastError: 'overloaded_error' })
    expect(screen.getByText(/overloaded_error/)).toBeInTheDocument()
  })

  it('clears the conversation', async () => {
    mount([msg({ role: 'assistant', content: 'hi' })])
    await userEvent.click(screen.getByRole('button', { name: 'Clear conversation' }))
    expect(api.clear).toHaveBeenCalled()
  })

  it('marks the thread read on mount so the activity-bar dot clears', () => {
    mount([msg({ role: 'assistant', content: 'hi' })])
    expect(api.markRead).toHaveBeenCalled()
  })

  it('subscribes to Overseer-created sessions so the sidebar refreshes', () => {
    mount([])
    expect(api.onSessionsChanged).toHaveBeenCalled()
  })
})
