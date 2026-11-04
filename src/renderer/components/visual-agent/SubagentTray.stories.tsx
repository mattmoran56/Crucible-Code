import React from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { SubagentTray } from './SubagentTray'
import type { Thread } from './transcript'

const thread = (id: string, brief: string, status: Thread['status'], steps: number): Thread => ({
  id,
  tool: 'Agent',
  brief,
  rows: [],
  children: [],
  status,
  steps,
  agentId: null,
})

// In start order, oldest first — the tray shows them newest first.
const THREADS: Thread[] = [
  thread('t1', 'Map the auth flow', 'done', 14),
  thread('t2', 'Find pointer handlers', 'done', 9),
  thread('t3', 'Audit form validation', 'failed', 6),
  thread('t4', 'Check Safari focus bug', 'done', 11),
  thread('t5', 'Review the store layer', 'stopped', 3),
  thread('t6', 'Write the migration', 'running', 7),
  thread('t7', 'Update the README', 'running', 2),
]

const meta: Meta<typeof SubagentTray> = {
  title: 'Visual Agent/SubagentTray',
  component: SubagentTray,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div style={{ width: 760, background: 'var(--color-bg)' }}>
        <Story />
      </div>
    ),
  ],
}
export default meta

type Story = StoryObj<typeof SubagentTray>

/** More sub-agents than fit: the newest (still working) are at the front, the oldest scroll off the end. */
export const NewestFirst: Story = {
  args: {
    ids: THREADS.map((t) => t.id),
    threads: new Map(THREADS.map((t) => [t.id, t])),
    openId: null,
    onOpen: () => {},
    register: () => {},
  },
}
