import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { SubagentTray } from '../../../../src/renderer/components/visual-agent/SubagentTray'
import type { Thread } from '../../../../src/renderer/components/visual-agent/transcript'

const thread = (id: string, brief: string, status: Thread['status']): Thread => ({
  id,
  tool: 'Agent',
  brief,
  rows: [],
  children: [],
  status,
  steps: 1,
  agentId: null,
})

describe('<SubagentTray>', () => {
  it('lists sub-agents newest first', () => {
    const threads = new Map<string, Thread>([
      ['a', thread('a', 'First', 'done')],
      ['b', thread('b', 'Second', 'done')],
      ['c', thread('c', 'Third', 'running')],
    ])
    render(<SubagentTray ids={['a', 'b', 'c']} threads={threads} openId={null} onOpen={vi.fn()} register={vi.fn()} />)
    const pills = within(screen.getByRole('group', { name: 'Subagents' })).getAllByRole('button')
    expect(pills.map((pill) => pill.getAttribute('aria-label'))).toEqual([
      expect.stringContaining('Third'),
      expect.stringContaining('Second'),
      expect.stringContaining('First'),
    ])
  })
})
