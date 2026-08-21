import type { Meta, StoryObj } from '@storybook/react'
import { useEffect, useState } from 'react'
import { OverseerPanel } from './OverseerPanel'
import { useOverseerStore } from '../../stores/overseerStore'
import { resetStores, setupStoresForStory } from '../../stories/helpers/storeSetup'
import type { OverseerMessage, OverseerSettings, OverseerState } from '../../../shared/types'

const settings: OverseerSettings = {
  apiKey: 'sk-ant-mock',
  model: 'claude-haiku-4-5',
  heartbeatSeconds: 60,
  heartbeatEnabled: true,
  dailyCostCapUsd: 2,
  maxIterations: 12,
  allowWrites: false,
}

let seq = 0
function msg(over: Partial<OverseerMessage> & { role: OverseerMessage['role'] }): OverseerMessage {
  seq += 1
  return {
    id: `m${seq}`,
    content: '',
    createdAt: new Date(Date.UTC(2026, 0, 1, 9, seq)).toISOString(),
    ...over,
  }
}

const FLEET_TABLE = `Four sessions across two projects.

| Session | Project | Status | Needs you |
|---|---|---|---|
| \`auth-refresh\` | Crucible | waiting on a question | **yes** — picking a token store |
| \`billing-webhooks\` | Crucible | working | no |
| \`flaky-e2e\` | Relay | waiting on permission | **yes** — wants to run \`docker compose\` |
| \`docs-sweep\` | Relay | finished its turn | review when you can |

\`auth-refresh\` is the one to look at first — it has been sitting for 11 minutes.`

const conversation: OverseerMessage[] = [
  msg({
    role: 'user',
    content:
      'Give me a table of all sessions, roughly where each is up to, and whether it needs input.',
  }),
  msg({ role: 'tool', content: 'Listed all sessions', toolName: 'list_sessions', toolOk: true }),
  msg({ role: 'tool', content: 'Read session 8a31f0c2', toolName: 'read_session', toolOk: true }),
  msg({ role: 'assistant', content: FLEET_TABLE }),
]

const heartbeat: OverseerMessage[] = [
  ...conversation,
  msg({ role: 'tool', content: 'Listed all sessions', toolName: 'list_sessions', toolOk: true }),
  msg({
    role: 'assistant',
    fromHeartbeat: true,
    needsAttention: true,
    content:
      '`flaky-e2e` is blocked on a tool-permission prompt — it wants to run `docker compose up`. That one is yours to answer.',
  }),
]

const refusal: OverseerMessage[] = [
  msg({ role: 'user', content: 'Just approve whatever flaky-e2e is asking for.' }),
  msg({
    role: 'tool',
    content: 'Messaged session 4c9a1b77',
    toolName: 'send_message_to_session',
    toolOk: false,
  }),
  msg({
    role: 'assistant',
    content:
      "I can't — `flaky-e2e` is showing a tool-permission prompt, and those are yours to answer. It is asking to run `docker compose up`. Open the session and choose there.",
  }),
]

function state(messages: OverseerMessage[], over: Partial<OverseerState> = {}): OverseerState {
  return {
    messages,
    running: false,
    spendTodayUsd: 0.014,
    spendDay: '2026-01-01',
    unread: 0,
    ...over,
  }
}

/** Seed the store directly — the panel reads everything from it. */
function Harness({ value }: { value: OverseerState }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    resetStores()
    setupStoresForStory()
    useOverseerStore.setState({ state: value, settings, loaded: true })
    setReady(true)
  }, [value])
  if (!ready) return null
  return (
    <div style={{ width: 380, height: 620, display: 'flex' }}>
      <OverseerPanel />
    </div>
  )
}

const meta: Meta<typeof Harness> = {
  title: 'Overseer/OverseerPanel',
  component: Harness,
  parameters: { layout: 'centered' },
}
export default meta

type Story = StoryObj<typeof Harness>

/** Empty thread — the prompts you can click to get started. */
export const Empty: Story = { args: { value: state([]) } }

/** The question this was built for: one table, whole fleet. */
export const FleetTable: Story = { args: { value: state(conversation) } }

/** A heartbeat speaking up on its own, flagged as needing you. */
export const HeartbeatReport: Story = { args: { value: state(heartbeat) } }

/** The write gate refusing to answer a tool-permission prompt. */
export const RefusesPermissionPrompt: Story = { args: { value: state(refusal) } }

/** Mid-pass, with the stop control available. */
export const Working: Story = {
  args: { value: state(conversation, { running: true }) },
}
