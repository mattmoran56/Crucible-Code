import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OverseerSettings } from '../../../../src/renderer/components/settings/OverseerSettings'
import { useOverseerStore } from '../../../../src/renderer/stores/overseerStore'
import type { OverseerSettings as Settings } from '../../../../src/shared/types'

const baseSettings: Settings = {
  apiKey: '',
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
  setSettings: vi.fn(async (p: Partial<Settings>) => ({ ...baseSettings, ...p })),
  send: vi.fn(),
  cancel: vi.fn(),
  clear: vi.fn(),
  heartbeatNow: vi.fn(),
  markRead: vi.fn(),
  onStateUpdate: vi.fn(() => () => {}),
  onSessionsChanged: vi.fn(() => () => {}),
}

function mount(over: Partial<Settings> = {}) {
  useOverseerStore.setState({
    state: { messages: [], running: false, spendTodayUsd: 0, spendDay: '', unread: 0 },
    settings: { ...baseSettings, ...over },
    loaded: true,
  })
  return render(<OverseerSettings />)
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(window as unknown as { api: unknown }).api = { overseer: api }
})

describe('OverseerSettings', () => {
  it('keeps the API key in a password field', () => {
    mount()
    expect(screen.getByPlaceholderText('sk-ant-…')).toHaveAttribute('type', 'password')
  })

  it('only saves the key when you ask it to', async () => {
    mount()
    const input = screen.getByPlaceholderText('sk-ant-…')
    const save = screen.getByRole('button', { name: 'Save' })

    expect(save).toBeDisabled()
    await userEvent.type(input, 'sk-ant-secret')
    expect(api.setSettings).not.toHaveBeenCalled()

    await userEvent.click(save)
    expect(api.setSettings).toHaveBeenCalledWith({ apiKey: 'sk-ant-secret' })
  })

  it('trims a pasted key', async () => {
    mount()
    await userEvent.type(screen.getByPlaceholderText('sk-ant-…'), '  sk-ant-x  ')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(api.setSettings).toHaveBeenCalledWith({ apiKey: 'sk-ant-x' })
  })

  it('explains that this is billed separately from the subscription', () => {
    mount()
    expect(screen.getByText(/separate from your Claude Code subscription/i)).toBeInTheDocument()
  })

  it('lists every model with its price', () => {
    mount()
    expect(screen.getByRole('option', { name: /Haiku 4.5.*\$1 \/ \$5/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Opus 5.*\$5 \/ \$25/ })).toBeInTheDocument()
  })

  it('saves the model immediately, since it is the cost lever', async () => {
    mount()
    await userEvent.selectOptions(screen.getByLabelText('Model'), 'claude-sonnet-5')
    expect(api.setSettings).toHaveBeenCalledWith({ model: 'claude-sonnet-5' })
  })

  it('saves the daily cost cap', async () => {
    mount()
    const cap = screen.getByLabelText('Daily cost cap (USD)')
    await userEvent.clear(cap)
    await userEvent.type(cap, '5')
    expect(api.setSettings).toHaveBeenCalledWith({ dailyCostCapUsd: 5 })
  })

  it('describes writes as off-by-default and permission prompts as out of bounds', () => {
    mount()
    expect(screen.getByLabelText(/allow writes/i)).not.toBeChecked()
    expect(screen.getByText(/refuses to answer a tool-permission prompt/i)).toBeInTheDocument()
  })

  it('toggles writes', async () => {
    mount()
    await userEvent.click(screen.getByLabelText(/allow writes/i))
    expect(api.setSettings).toHaveBeenCalledWith({ allowWrites: true })
  })

  it('toggles the heartbeat and explains why a quiet tick is free', async () => {
    mount()
    await userEvent.click(screen.getByLabelText(/check the fleet on a timer/i))
    expect(api.setSettings).toHaveBeenCalledWith({ heartbeatEnabled: true })
    expect(screen.getByText(/never reaches the model/i)).toBeInTheDocument()
  })

  it('renders nothing until settings have loaded', () => {
    useOverseerStore.setState({
      state: { messages: [], running: false, spendTodayUsd: 0, spendDay: '', unread: 0 },
      settings: null,
      loaded: true,
    })
    const { container } = render(<OverseerSettings />)
    expect(container).toBeEmptyDOMElement()
  })
})
