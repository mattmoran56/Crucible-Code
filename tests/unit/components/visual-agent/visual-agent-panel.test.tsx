import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { VisualAgentPanel } from '../../../../src/renderer/components/visual-agent/VisualAgentPanel'
import { __resetVisualAgentSubscription, useVisualAgentStore } from '../../../../src/renderer/stores/visualAgentStore'
import {
  DEMO_ASK_ID,
  DEMO_CWD,
  DEMO_TASK_TOOL_ID,
  demoVisualAgentSnapshot,
} from '../../../../src/renderer/components/visual-agent/__fixtures__/demo'

const api = {
  start: vi.fn(),
  getState: vi.fn(async () => null),
  send: vi.fn(async () => {}),
  interrupt: vi.fn(async () => {}),
  stop: vi.fn(async () => {}),
  answer: vi.fn(async () => {}),
  setModel: vi.fn(async () => {}),
  fork: vi.fn(async () => ({ forkId: 'f' })),
  forkStop: vi.fn(async () => {}),
  onFrame: vi.fn(() => () => {}),
}

const mount = () => {
  useVisualAgentStore.getState().seed(demoVisualAgentSnapshot('p1'))
  return render(<VisualAgentPanel agentId="p1" startOptions={{ agentId: 'p1', sessionId: 's', cwd: DEMO_CWD }} visible />)
}

beforeEach(() => {
  vi.clearAllMocks()
  __resetVisualAgentSubscription()
  useVisualAgentStore.setState({ agents: {}, errors: {}, ui: {}, options: {} })
  ;(window as any).api = { visualAgent: api }
})

describe('<VisualAgentPanel>', () => {
  it('renders the conversation log without restarting a seeded agent', () => {
    mount()
    expect(screen.getByRole('log', { name: 'Conversation' })).toBeInTheDocument()
    expect(screen.getByText(/does nothing on Safari/)).toBeInTheDocument()
    expect(api.start).not.toHaveBeenCalled()
  })

  it('answers a pending permission ask', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Always allow' }))
    expect(api.answer).toHaveBeenCalledWith('p1', DEMO_ASK_ID, 'always', undefined)
  })

  it('opens the sub-agent sheet from its tray pill and closes it with Esc', () => {
    mount()
    const tray = screen.getByRole('group', { name: 'Subagents' })
    fireEvent.click(within(tray).getByRole('button', { name: /Task/ }))
    expect(useVisualAgentStore.getState().ui.p1.subagentPath).toEqual([DEMO_TASK_TOOL_ID])
    const sheet = screen.getByRole('dialog', { name: /Task transcript/ })
    expect(within(sheet).getByText(/Searching for pointer handlers/)).toBeInTheDocument()
    fireEvent.keyDown(sheet, { key: 'Escape' })
    expect(useVisualAgentStore.getState().ui.p1.subagentPath).toEqual([])
  })

  it('reopens a side question from its marker', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: /Side question asked here/ }))
    expect(useVisualAgentStore.getState().ui.p1.openForkId).toBe('fork-demo-01')
    expect(screen.getByText(/Forked from the conversation as it stood/)).toBeInTheDocument()
  })

  it('stays pinned to the bottom through browser scroll resets, and lets go on a wheel', () => {
    mount()
    const log = screen.getByRole('log', { name: 'Conversation' })
    Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 1000 })
    Object.defineProperty(log, 'clientHeight', { configurable: true, value: 400 })
    // The browser resets scrollTop (re-layout, node moved): re-pinned.
    log.scrollTop = 0
    fireEvent.scroll(log)
    expect(log.scrollTop).toBe(1000)
    // The reader scrolls up: let go.
    fireEvent.wheel(log)
    log.scrollTop = 100
    fireEvent.scroll(log)
    expect(log.scrollTop).toBe(100)
  })
})
