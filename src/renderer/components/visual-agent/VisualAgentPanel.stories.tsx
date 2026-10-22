import React, { useLayoutEffect, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import type { VisualAgentCommand, VisualAgentSnapshot } from '../../../shared/visual-agent'
import { useVisualAgentStore, type VisualAgentUi } from '../../stores/visualAgentStore'
import { VisualAgentPanel } from './VisualAgentPanel'
import {
  AUDIT_TASK_ID,
  DEMO_CWD,
  NESTED_TASK_ID,
  conversationSnapshot,
  demoSnapshot,
  emptySnapshotFixture,
  runningFork,
  streamingSnapshot,
} from './__fixtures__/demo'

/** Seeds the store for one agent, then mounts the panel (seeded agents skip `start`). */
function Seeded({ snapshot, ui }: { snapshot: VisualAgentSnapshot; ui?: Partial<VisualAgentUi> }) {
  const [ready, setReady] = useState(false)
  useLayoutEffect(() => {
    useVisualAgentStore.getState().seed(snapshot, { draft: '', openForkId: null, subagentPath: [], answering: null, ...ui })
    setReady(true)
    // Give the mock bridge a snapshot for this agent too, so the frames it
    // emits when you interact (send, /btw, answer) have something to build on.
    const bridge = (window as unknown as { api?: { visualAgent?: { start: (o: object) => Promise<unknown> } } }).api
      ?.visualAgent
    void bridge?.start({ agentId: snapshot.agentId, sessionId: 'story-session', cwd: DEMO_CWD })
  }, [snapshot, ui])
  if (!ready) return null
  return (
    <div className="flex h-screen w-full flex-col bg-bg">
      <VisualAgentPanel
        agentId={snapshot.agentId}
        startOptions={{ agentId: snapshot.agentId, sessionId: 'story-session', cwd: DEMO_CWD }}
        visible
      />
    </div>
  )
}

const meta: Meta<typeof Seeded> = {
  title: 'Visual Agent/VisualAgentPanel',
  component: Seeded,
  parameters: { layout: 'fullscreen' },
}
export default meta

type Story = StoryObj<typeof Seeded>

/** The backend demo: tools, an Edit diff, a Task sub-agent and a pending Bash permission ask. */
export const Conversation: Story = {
  args: { snapshot: demoSnapshot('story-conversation') },
}

/** A longer run: todo list, MultiEdit/Write diffs, nested sub-agents, a failure, compaction and an AskUserQuestion. */
export const FullRun: Story = {
  args: { snapshot: conversationSnapshot('story-full-run') },
}

/** A turn in flight: thinking, streaming text with a caret, the live turn bar. */
export const Streaming: Story = {
  args: { snapshot: streamingSnapshot('story-streaming') },
}

/** Typing `/` slides the command menu up over the composer. */
export const SlashMenuOpen: Story = {
  args: {
    snapshot: { ...demoSnapshot('story-slash'), state: 'idle', turnStartedAt: null },
    ui: { draft: '/' },
  },
}

/** What a session's Claude Code reports: the repo's commands and skills, then built-ins. */
const REPORTED_COMMANDS: VisualAgentCommand[] = [
  { name: 'deploy', description: 'Deploy the current branch to an environment (project)', argumentHint: '<env>', builtin: false },
  { name: 'run-tests', description: 'Run the unit and e2e suites and summarise failures (project)', argumentHint: '[pattern]', builtin: false },
  { name: 'update-screenshots', description: 'Capture and verify screenshots from Storybook for the README (project)', argumentHint: '', builtin: false },
  { name: 'notion-ticket', description: 'Pick up a Notion ticket and start work on it (user)', argumentHint: '<ticket url>', builtin: false },
  { name: 'compact', description: 'Clear conversation history but keep a summary in context', argumentHint: '[instructions]', builtin: true },
  { name: 'init', description: 'Initialize a new CLAUDE.md file with codebase documentation', argumentHint: '', builtin: true },
  { name: 'review', description: 'Review a pull request', argumentHint: '', builtin: true },
]

/** Typing `/` lists what the session's Claude Code offers: the repo's commands and skills first. */
export const SlashMenuRepoCommands: Story = {
  args: {
    snapshot: { ...demoSnapshot('story-slash-repo'), state: 'idle', turnStartedAt: null, commands: REPORTED_COMMANDS },
    ui: { draft: '/' },
  },
}

/** A /btw side question answered in the fork sheet. */
export const ForkSheetOpen: Story = {
  args: {
    snapshot: { ...demoSnapshot('story-fork'), state: 'idle', turnStartedAt: null },
    ui: { openForkId: 'fork-demo-01' },
  },
}

/** A fork still answering. */
export const ForkSheetRunning: Story = {
  args: {
    snapshot: { ...conversationSnapshot('story-fork-running'), forks: [runningFork()] },
    ui: { openForkId: 'fork-fx-running' },
  },
}

/** A nested sub-agent open in the right-hand sheet, with its breadcrumb. */
export const SubagentSheetOpen: Story = {
  args: {
    snapshot: conversationSnapshot('story-subagent'),
    ui: { subagentPath: [AUDIT_TASK_ID, NESTED_TASK_ID] },
  },
}

export const Empty: Story = {
  args: { snapshot: emptySnapshotFixture('story-empty') },
}
