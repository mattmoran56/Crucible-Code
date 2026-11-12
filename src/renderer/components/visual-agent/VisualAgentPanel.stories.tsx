import React, { useLayoutEffect, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import type { VisualAgentAttachment, VisualAgentCommand, VisualAgentModel, VisualAgentSnapshot } from '../../../shared/visual-agent'
import { useVisualAgentStore, type VisualAgentUi } from '../../stores/visualAgentStore'
import { useAudioSettingsStore } from '../../stores/audioSettingsStore'
import { useSpeechStore } from '../../stores/speechStore'
import { AsideSplit } from './AsidePanel'
import { VisualAgentPanel } from './VisualAgentPanel'
import {
  AUDIT_TASK_ID,
  BACKGROUND_TASK_ID,
  DEMO_CWD,
  backgroundSubagentSnapshot,
  NESTED_TASK_ID,
  conversationSnapshot,
  demoSnapshot,
  emptySnapshotFixture,
  runningFork,
  streamingSnapshot,
} from './__fixtures__/demo'

/** Seeds the store for one agent, then mounts the panel (seeded agents skip `start`). */
function Seeded({
  snapshot,
  ui,
  audio,
}: {
  snapshot: VisualAgentSnapshot
  ui?: Partial<VisualAgentUi>
  /** An audio-mode session, with audio out on and (optionally) this message being spoken. */
  audio?: { speakingKey: string | null }
}) {
  const [ready, setReady] = useState(false)
  useLayoutEffect(() => {
    useAudioSettingsStore.getState().reset({ enabled: !!audio })
    useSpeechStore.setState({
      speakingAgentId: audio?.speakingKey ? snapshot.agentId : null,
      speakingKey: audio?.speakingKey ?? null,
      // Stories never load the voice engine.
      ensureEngine: async () => undefined,
    })
    useVisualAgentStore.getState().seed(snapshot, { draft: '', openForkId: null, asideDrafts: {}, subagentPath: [], answering: null, ...ui })
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
      <AsideSplit agentId={snapshot.agentId} visible>
        <VisualAgentPanel
          agentId={snapshot.agentId}
          startOptions={{ agentId: snapshot.agentId, sessionId: 'story-session', cwd: DEMO_CWD, audioMode: !!audio }}
          visible
        />
      </AsideSplit>
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

/** What a session's Claude Code reports from its `initialize` reply (2.1.322, trimmed). */
const REPORTED_MODELS: VisualAgentModel[] = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', hint: 'Best for everyday, complex tasks' },
  { id: 'claude-fable-5-2', label: 'Fable 5.2', hint: 'Most capable for your hardest and longest-running tasks' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', hint: 'Efficient for routine tasks' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5', hint: 'Fastest for quick answers' },
  { id: 'claude-fable-5-1', label: 'Fable 5.1', hint: 'Most capable for your hardest and longest-running tasks' },
  { id: 'claude-opus-5', label: 'Opus 5', hint: 'Best for everyday, complex tasks' },
  { id: 'claude-opus-4-8', label: 'Opus 4.8', hint: 'Best for everyday, complex tasks' },
]

/** The model pill lists what the session's Claude Code says the account can use. */
export const ReportedModels: Story = {
  args: {
    snapshot: { ...demoSnapshot('story-models'), state: 'idle', turnStartedAt: null, model: 'claude-fable-5-2', models: REPORTED_MODELS },
  },
}

/** A /btw aside answered in its own panel, slid out beside the conversation. */
export const AsideOpen: Story = {
  args: {
    snapshot: { ...demoSnapshot('story-fork'), state: 'idle', turnStartedAt: null },
    ui: { openForkId: 'fork-demo-01' },
  },
}

/** An aside still answering. */
export const AsideRunning: Story = {
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

/** A background sub-agent still working after its "launched" result, open with a message sent to it. */
export const BackgroundSubagentWorking: Story = {
  args: {
    snapshot: backgroundSubagentSnapshot('story-background'),
    ui: { subagentPath: [BACKGROUND_TASK_ID] },
  },
}

/** The same run with the sheet closed: the tray pill still says it is working. */
export const BackgroundSubagentTray: Story = {
  args: { snapshot: backgroundSubagentSnapshot('story-background-tray') },
}

export const Empty: Story = {
  args: { snapshot: emptySnapshotFixture('story-empty') },
}

/** A small gradient PNG standing in for a screenshot. */
const SCREENSHOT_PNG = 'iVBORw0KGgoAAAANSUhEUgAAADAAAAAgCAIAAADbtmxLAAAAr0lEQVR42u3OCQoBARiAUTmmlJJS0qeUlJIi2ZosIdkiCU0iJCFLE5omsiXkMK4h/e8Ez2ThY+Vt42nn4eDu5Ori7Obk4ejF8KH7OQTYBdFCbMOso6ziLJPMFWYZpjkmBUYlhhUGNfoN1Ba9Np0ubZVWn+aQxpj6lOqM8oLSiuKGvEZuT1YnbaCcSF1I3Ig9iL6ImE0/RkISkpCEJCQhCUlIQhKSkIQkJCEJSei/Q1+5O1J/LxG+NQAAAABJRU5ErkJggg=='
const ATTACHMENTS: VisualAgentAttachment[] = [
  { name: 'login-bug.png', type: 'image/png', size: 232, data: SCREENSHOT_PNG },
  { name: 'error-log.txt', type: 'text/plain', size: 1024, data: 'ZXJyb3I=' },
]

/** Files waiting in the composer (picked with +, pasted, or dropped), and an earlier message that carried some. */
export const WithAttachments: Story = {
  args: {
    snapshot: {
      ...emptySnapshotFixture('story-attachments'),
      state: 'idle',
      events: [
        {
          uuid: 'u-attach-1',
          seq: 1,
          threadId: 'main',
          at: '2026-10-27T09:00:00.000Z',
          kind: 'text',
          role: 'user',
          text:
            'The sign-in button overlaps the footer on narrow screens — see the screenshot.\n\n' +
            '[Attached file: /tmp/crucible-code-attachments/story/mh2k1x9a-0-narrow-viewport.png]\n' +
            '[Attached file: /tmp/crucible-code-attachments/story/mh2k1x9a-1-design-spec.pdf]',
        },
        {
          uuid: 'a-attach-1',
          seq: 2,
          threadId: 'main',
          at: '2026-10-27T09:00:05.000Z',
          kind: 'text',
          role: 'assistant',
          text: 'I can see it: the footer is `position: fixed` and the form has no bottom padding below 480px. The spec asks for 24px of clearance, so I\'ll add that to the auth layout.',
        },
      ],
    },
    ui: { draft: 'Here is the console output too', attachments: ATTACHMENTS },
  },
}

/** An audio-mode reply: plain spoken prose, a tool call in between, read aloud as it streams. */
const audioSnapshot = (agentId: string): VisualAgentSnapshot => {
  const at = '2026-11-12T09:00:00.000Z'
  const base = { threadId: 'main', at }
  return {
    agentId,
    claudeSessionId: '7c0ffee0-0000-4000-8000-000000000001',
    model: 'claude-opus-5-5',
    state: 'idle',
    turnStartedAt: null,
    partial: null,
    usage: null,
    forks: [],
    events: [
      { ...base, uuid: 'u1', seq: 1, kind: 'text', role: 'user', text: 'Why is the settings test flaky?' },
      {
        ...base,
        uuid: 'a1',
        seq: 2,
        kind: 'text',
        role: 'assistant',
        text: "Let me look at the test and the store it touches. I'll check how the theme is loaded first.",
      },
      { ...base, uuid: 't1', seq: 3, kind: 'tool', id: 'toolu_1', name: 'Read', input: { file_path: `${DEMO_CWD}/tests/e2e/theme-settings.spec.ts` }, spawnsThread: false },
      { ...base, uuid: 't2', seq: 4, kind: 'tool-result', id: 'toolu_1', ok: true, text: '…' },
      {
        ...base,
        uuid: 'a2',
        seq: 5,
        kind: 'text',
        role: 'assistant',
        text:
          "Found it. The test opens settings before the saved theme has loaded, so about one run in ten it reads the default instead. " +
          "I've made it wait for the theme to apply before it clicks, and it passed fifty runs in a row. The change is in the theme settings spec if you want to look.",
      },
      { ...base, uuid: 'r1', seq: 6, kind: 'result', ok: true, costUsd: 0.04, durationMs: 21000, usage: null, text: '' },
    ],
  }
}

/** An audio-mode session reading its latest reply aloud: speaker badge, Stop speaking, Mute, and Replay. */
export const AudioMode: Story = {
  args: { snapshot: audioSnapshot('story-audio'), audio: { speakingKey: 'a2' } },
}

/** An audio-mode session between replies: hover a message to replay it. */
export const AudioModeIdle: Story = {
  args: { snapshot: audioSnapshot('story-audio-idle'), audio: { speakingKey: null } },
}
