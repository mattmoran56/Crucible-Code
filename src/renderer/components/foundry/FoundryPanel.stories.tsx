import type { Meta, StoryObj } from '@storybook/react'
import { useEffect, useState } from 'react'
import { FoundryPanel } from './FoundryPanel'
import { useFoundryStore } from '../../stores/foundryStore'
import { resetStores, setupStoresForStory } from '../../stories/helpers/storeSetup'
import type {
  FoundryConfig,
  FoundryRuntimeState,
} from '../../../shared/types'

const projectId = 'proj-1'

const baseConfig: FoundryConfig = {
  id: 'fnd-1',
  name: 'Simulation attempt tracking',
  projectId,
  enabled: true,
  taskSetFilters: [],
  completionTransition: { property: 'Status', fromValue: 'In review', toValue: 'Testing' },
  completedStatuses: ['Done', 'Testing'],
  pickupUpdates: [
    { property: 'Status', type: 'status', value: 'In Progress' },
  ],
  readyForReviewUpdates: [
    { property: 'Status', type: 'status', value: 'In review' },
  ],
  implementCommandTemplate:
    '/notion-ticket {{taskUrl}}\n\nWhen the ticket is fully implemented:\n1. Stage and commit…',
  readyForReviewCommandTemplate:
    'Update the PR review checklist. Use ✓, ✗, and ⊘ …',
  branchNameTemplate: 'foundry/{{taskTitleSlug}}',
  baseBranch: 'project/simulation-attempt-tracking',
  maxConcurrentTasks: 3,
  workerPermissionMode: 'default',
  triggerOnCompletedStatusEnter: true,
}

const offConfig: FoundryConfig = { ...baseConfig, enabled: false }

const stubApi = (setup: SetupOptions): void => {
  const api = (window as any).api ?? {}
  ;(window as any).api = {
    ...api,
    foundry: {
      ...(api.foundry ?? {}),
      list: async () => setup.configs,
      getState: async (foundryId: string) => setup.states?.[foundryId] ?? null,
      runNow: async () => {},
      setPaused: async () => {},
      pipelineAction: async () => {},
      publishPRs: async () => {},
      openForeman: async () => null,
      onFireTask: () => () => {},
      onStateUpdate: () => () => {},
      resetState: async () => ({ ok: true }),
    },
  }
}

interface SetupOptions {
  configs: FoundryConfig[]
  states?: Record<string, FoundryRuntimeState>
}

/** Convenience for single-foundry stories. */
function single(config: FoundryConfig, state?: FoundryRuntimeState): SetupOptions {
  return { configs: [config], states: state ? { [config.id]: state } : {} }
}

function Wrapper({ setup }: { setup: SetupOptions }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    resetStores()
    setupStoresForStory()
    stubApi(setup)
    useFoundryStore.setState({
      configs: setup.configs,
      states: setup.states ?? {},
    })
    setReady(true)
  }, [setup])

  if (!ready) return null
  return (
    <div
      style={{
        width: 360,
        height: 760,
        background: 'var(--color-bg-secondary)',
        display: 'flex',
        flexDirection: 'column',
        border: '1px solid var(--color-border)',
        borderRadius: 4,
      }}
    >
      <FoundryPanel />
    </div>
  )
}

const meta: Meta<typeof FoundryPanel> = {
  title: 'Foundry/Panel',
  component: FoundryPanel,
  parameters: { layout: 'centered' },
}
export default meta
type Story = StoryObj<typeof FoundryPanel>

export const Off: Story = {
  render: () => <Wrapper setup={single(offConfig)} />,
}

const passInFlightState: FoundryRuntimeState = {
  foundryId: baseConfig.id,
  pageStatusSnapshot: {},
  documentedHashes: {},
  pipelines: [],
  passes: [
    {
      index: 1,
      startedAt: new Date(Date.now() - 12_000).toISOString(),
      status: 'running',
      trigger: 'enabled',
      startedPageIds: [],
      transcript: [
        '[14:21:03] ▶ session a7f3… started (claude-opus-4.7)',
        '[14:21:04] Reading context.json from /Users/dev/.../pass-1/',
        '[14:21:06] 20 tasks in set, 0 currently running, 3 free slots.',
        '[14:21:08] 🔧 Read /Users/dev/redeployable-monorepo/cmd/api/main.go',
        "[14:21:11] Phase 1 schema work (T1.1, T1.2, T1.3) looks like the critical path —",
        "[14:21:11] independent additive migrations, all gate Phase 2.",
        '[14:21:14] 🔧 Read /Users/dev/redeployable-monorepo/internal/attempts/repo.go',
        "[14:21:17] Confirming T1.4 has no deps beyond T1.1; T1.5 needs T1.2 + T1.3.",
      ],
    },
  ],
  passInFlight: true,
}

export const PassRunning: Story = {
  render: () => <Wrapper setup={single(baseConfig, passInFlightState)} />,
}

const runningPipelinesState: FoundryRuntimeState = {
  foundryId: baseConfig.id,
  pageStatusSnapshot: {},
  documentedHashes: {},
  pipelines: [
    {
      id: 'pipe-1',
      foundryId: baseConfig.id,
      page: {
        id: 'p1',
        url: 'https://app.notion.com/p/t1-1',
        title: '[T1.1] Create user_job_drop_attempts table',
        rawProperties: {},
      },
      phase: 'reviewing',
      sessionId: 'sess-pipe-1',
      branch: 'feat/attempts-table',
      worktreePath: '/Users/dev/.codecrucible-worktrees/redeployable-monorepo/attempts-table',
      baseBranch: 'project/simulation-attempt-tracking',
      prNumber: 412,
      prUrl: 'https://github.com/redeployable-io/redeployable-monorepo/pull/412',
      startedAt: new Date(Date.now() - 18 * 60_000).toISOString(),
      updatedAt: new Date(Date.now() - 60_000).toISOString(),
      log: [
        '[14:03:11] Pipeline started — T1.1 — additive schema migration, critical-path root.',
        '[14:03:13] Pushed feat/attempts-table to origin.',
        '[14:06:42] Draft PR #412 detected — starting review loop.',
        '[14:06:43] Review loop started for PR #412.',
      ],
    },
    {
      id: 'pipe-2',
      foundryId: baseConfig.id,
      page: {
        id: 'p2',
        url: 'https://app.notion.com/p/t1-2',
        title: '[T1.2] Add nullable attempt_id to user_job_drop_task_steps',
        rawProperties: {},
      },
      phase: 'implementing',
      sessionId: 'sess-pipe-2',
      branch: 'feat/attempt-id-column-steps',
      worktreePath: '/Users/dev/.codecrucible-worktrees/redeployable-monorepo/attempt-id-column-steps',
      baseBranch: 'project/simulation-attempt-tracking',
      startedAt: new Date(Date.now() - 6 * 60_000).toISOString(),
      updatedAt: new Date(Date.now() - 30_000).toISOString(),
      log: [
        '[14:15:11] Pipeline started — T1.2 — sibling of T1.1 on a different table.',
        '[14:15:14] Worker session 19a94c8e… spawned on feat/attempt-id-column-steps.',
      ],
    },
    {
      id: 'pipe-3',
      foundryId: baseConfig.id,
      page: {
        id: 'p3',
        url: 'https://app.notion.com/p/t1-3',
        title: '[T1.3] Add nullable attempt_id to user_job_drop_tasks',
        rawProperties: {},
      },
      phase: 'implementing',
      sessionId: 'sess-pipe-3',
      branch: 'feat/attempt-id-column-tasks',
      worktreePath: '/Users/dev/.codecrucible-worktrees/redeployable-monorepo/attempt-id-column-tasks',
      baseBranch: 'project/simulation-attempt-tracking',
      attention: {
        reason: 'no PR after 60m — worker may be stuck',
        since: new Date(Date.now() - 2 * 60_000).toISOString(),
      },
      startedAt: new Date(Date.now() - 65 * 60_000).toISOString(),
      updatedAt: new Date(Date.now() - 30_000).toISOString(),
      log: [
        '[13:16:11] Pipeline started — T1.3 — sibling of T1.2 on another table.',
        '[13:16:14] Worker session 0307f5ec… spawned on feat/attempt-id-column-tasks.',
        '[14:16:42] PR-poll timeout after 60m without a PR.',
      ],
    },
  ],
  passes: [
    {
      index: 1,
      startedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
      endedAt: new Date(Date.now() - 19 * 60_000).toISOString(),
      status: 'completed',
      trigger: 'enabled',
      startedPageIds: ['p1', 'p2', 'p3'],
      summary: 'started 3 (Phase 1 critical path)',
      transcript: [],
    },
  ],
  passInFlight: false,
}

export const ActivePipelines: Story = {
  render: () => <Wrapper setup={single(baseConfig, runningPipelinesState)} />,
}

// --- Multiple foundries running at once (tab selector) ---

const secondConfig: FoundryConfig = {
  ...baseConfig,
  id: 'fnd-2',
  name: 'Billing webhooks reconciliation',
  baseBranch: 'project/billing-webhooks',
  maxConcurrentTasks: 2,
}

const thirdConfig: FoundryConfig = {
  ...baseConfig,
  id: 'fnd-3',
  name: 'Docs site migration',
  baseBranch: 'project/docs-migration',
  paused: true,
  maxConcurrentTasks: 1,
}

const secondState: FoundryRuntimeState = {
  foundryId: secondConfig.id,
  pageStatusSnapshot: {},
  documentedHashes: {},
  pipelines: [
    {
      id: 'pipe-b1',
      foundryId: secondConfig.id,
      page: {
        id: 'pb1',
        url: 'https://app.notion.com/p/b1',
        title: '[B2.1] Reconcile failed Stripe webhook retries',
        rawProperties: {},
      },
      phase: 'implementing',
      sessionId: 'sess-pipe-b1',
      branch: 'feat/webhook-retries',
      worktreePath: '/Users/dev/.codecrucible-worktrees/redeployable-monorepo/webhook-retries',
      baseBranch: 'project/billing-webhooks',
      startedAt: new Date(Date.now() - 9 * 60_000).toISOString(),
      updatedAt: new Date(Date.now() - 40_000).toISOString(),
      log: ['[15:02:11] Pipeline started — B2.1.'],
    },
  ],
  passes: [
    {
      index: 1,
      startedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
      endedAt: new Date(Date.now() - 9 * 60_000).toISOString(),
      status: 'completed',
      trigger: 'enabled',
      startedPageIds: ['pb1'],
      summary: 'started 1',
      transcript: [],
    },
  ],
  passInFlight: false,
}

export const MultipleFoundries: Story = {
  render: () => (
    <Wrapper
      setup={{
        configs: [baseConfig, secondConfig, thirdConfig],
        states: {
          [baseConfig.id]: runningPipelinesState,
          [secondConfig.id]: secondState,
        },
      }}
    />
  ),
}
