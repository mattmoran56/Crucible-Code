import React from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { SubagentTray } from './SubagentTray'
import { MAIN_THREAD, buildTranscript, type Thread } from './transcript'
import type { VisualAgentEvent } from '../../../shared/visual-agent'

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

const at = '2026-10-21T09:00:00.000Z'
const spawn = (id: string, brief: string, threadId: string): VisualAgentEvent => ({
  uuid: `s-${id}`, seq: 0, at, threadId, kind: 'tool', id, name: 'Agent', input: { description: brief }, spawnsThread: true,
})
const answer = (id: string, threadId: string): VisualAgentEvent => ({
  uuid: `r-${id}`, seq: 0, at, threadId, kind: 'tool-result', id, ok: true, text: 'done',
})
// "Plan refactor" and "Find callers" have both had their results, but
// "Read legacy", two levels down, is still going — so they are too.
const NESTED = buildTranscript([
  spawn('p', 'Plan refactor', MAIN_THREAD),
  spawn('q', 'Find callers', 'p'),
  spawn('r', 'Read legacy', 'q'),
  answer('q', 'p'),
  answer('p', MAIN_THREAD),
  spawn('s', 'Changelog', MAIN_THREAD),
  answer('s', MAIN_THREAD),
])
const nestedIds = ['p', 'q', 'r', 's']

/** A sub-agent stays running while any sub-agent beneath it, at any depth, is still running. */
export const NestedStillRunning: Story = {
  args: {
    ids: nestedIds,
    threads: NESTED.threads,
    openId: null,
    onOpen: () => {},
    register: () => {},
  },
}

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
