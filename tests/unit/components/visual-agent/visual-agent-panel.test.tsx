import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { AsideSplit } from '../../../../src/renderer/components/visual-agent/AsidePanel'
import { VisualAgentPanel } from '../../../../src/renderer/components/visual-agent/VisualAgentPanel'
import { __resetVisualAgentSubscription, useVisualAgentStore } from '../../../../src/renderer/stores/visualAgentStore'
import {
  BACKGROUND_TASK_ID,
  DEMO_ASK_ID,
  backgroundSubagentSnapshot,
  DEMO_CWD,
  DEMO_TASK_TOOL_ID,
  demoVisualAgentSnapshot,
} from '../../../../src/renderer/components/visual-agent/__fixtures__/demo'
import { parseSubagentRelay } from '../../../../src/shared/visual-agent'

const api = {
  start: vi.fn(),
  getState: vi.fn(async () => null),
  send: vi.fn(async () => {}),
  interrupt: vi.fn(async () => {}),
  stop: vi.fn(async () => {}),
  answer: vi.fn(async () => {}),
  setModel: vi.fn(async () => {}),
  fork: vi.fn(async () => ({ forkId: 'f' })),
  forkSend: vi.fn(async () => {}),
  forkStop: vi.fn(async () => {}),
  onFrame: vi.fn(() => () => {}),
}

const mount = () => {
  useVisualAgentStore.getState().seed(demoVisualAgentSnapshot('p1'))
  return render(
    <AsideSplit agentId="p1" visible>
      <VisualAgentPanel agentId="p1" startOptions={{ agentId: 'p1', sessionId: 's', cwd: DEMO_CWD }} visible />
    </AsideSplit>,
  )
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

  it('shows a background sub-agent as working, and messages it through the main agent', () => {
    useVisualAgentStore.getState().seed(backgroundSubagentSnapshot('p1'))
    render(<VisualAgentPanel agentId="p1" startOptions={{ agentId: 'p1', sessionId: 's', cwd: DEMO_CWD }} visible />)
    const tray = screen.getByRole('group', { name: 'Subagents' })
    const pill = within(tray).getByRole('button', { name: /Agent/ })
    expect(pill).toHaveAccessibleName(/working/)
    fireEvent.click(pill)
    expect(useVisualAgentStore.getState().ui.p1.subagentPath).toEqual([BACKGROUND_TASK_ID])

    const sheet = screen.getByRole('dialog', { name: /Agent transcript/ })
    expect(within(sheet).getByText('working')).toBeInTheDocument()
    // What the person sent it earlier shows in its own conversation.
    expect(within(sheet).getByText(/Skip SignIn.tsx/)).toBeInTheDocument()
    const box = within(sheet).getByRole('textbox', { name: /Message Audit forms/ })
    fireEvent.change(box, { target: { value: 'Also check NewsletterForm' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(api.send).toHaveBeenCalledTimes(1)
    const [id, text] = api.send.mock.calls[0] as unknown as [string, string]
    expect(id).toBe('p1')
    expect(parseSubagentRelay(text)).toEqual({ toolUseId: BACKGROUND_TASK_ID, agentId: 'a630f81b1da91f49f', text: 'Also check NewsletterForm' })
    expect(box).toHaveValue('')
  })

  it('reopens an aside from its marker in a panel beside the conversation, and closes it with Esc', () => {
    mount()
    expect(screen.queryByTestId('aside-panel')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Side question asked here/ }))
    expect(useVisualAgentStore.getState().ui.p1.openForkId).toBe('fork-demo-01')
    const aside = screen.getByTestId('aside-panel')
    expect(within(aside).getByText(/Forked from the conversation as it stood/)).toBeInTheDocument()
    // The question opens the aside's conversation, followed by the answer.
    const log = within(aside).getByRole('log')
    expect(within(log).getByText('Why not just add a click handler too?')).toBeInTheDocument()
    // The main conversation stays on screen beside it.
    expect(screen.getByRole('log', { name: 'Conversation' })).toBeInTheDocument()
    fireEvent.keyDown(aside, { key: 'Escape' })
    expect(useVisualAgentStore.getState().ui.p1.openForkId).toBeNull()
  })

  it('sends a follow-up from the aside chat bar into the fork, not the main conversation', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: /Side question asked here/ }))
    const box = screen.getByRole('textbox', { name: 'Follow up in the aside' })
    fireEvent.change(box, { target: { value: 'and on touch screens?' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(api.forkSend).toHaveBeenCalledWith('p1', 'fork-demo-01', 'and on touch screens?')
    expect(api.send).not.toHaveBeenCalled()
    expect(useVisualAgentStore.getState().ui.p1.asideDrafts['fork-demo-01']).toBe('')
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

  it('attaches files dropped anywhere on the panel and sends them with the message', async () => {
    mount()
    const log = screen.getByRole('log', { name: 'Conversation' })
    const file = new File(['png'], 'shot.png', { type: 'image/png' })
    const dataTransfer = { types: ['Files'], files: [file], dropEffect: 'none' }
    fireEvent.dragEnter(log, { dataTransfer })
    expect(screen.getByTestId('attachment-drop-zone')).toHaveTextContent('Drop images or files to attach')
    fireEvent.drop(log, { dataTransfer })
    expect(screen.queryByTestId('attachment-drop-zone')).toBeNull()
    const chips = await screen.findByRole('list', { name: 'Attachments' })
    expect(chips).toHaveTextContent('shot.png')

    fireEvent.change(screen.getByLabelText('Message Claude'), { target: { value: 'what is this?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(api.send).toHaveBeenCalledWith('p1', 'what is this?', [
      { name: 'shot.png', type: 'image/png', size: 3, data: btoa('png') },
    ])
    expect(screen.queryByRole('list', { name: 'Attachments' })).toBeNull()
    expect(await screen.findByRole('list', { name: 'Attached files' })).toHaveTextContent('shot.png')
  })

  it('ignores drags that carry no files', () => {
    mount()
    fireEvent.dragEnter(screen.getByRole('log', { name: 'Conversation' }), { dataTransfer: { types: ['text/plain'], files: [] } })
    expect(screen.queryByTestId('attachment-drop-zone')).toBeNull()
  })
})

