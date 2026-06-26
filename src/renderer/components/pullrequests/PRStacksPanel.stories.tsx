import type { Meta, StoryObj } from '@storybook/react'
import { useEffect, useState } from 'react'
import { PRStacksPanel } from './PRStacksPanel'
import { usePRStackStore } from '../../stores/prStackStore'
import { resetStores, setupStoresForStory } from '../../stories/helpers/storeSetup'
import type { LocalPR, PRStack, PullRequest } from '../../../shared/types'

const projectId = 'proj-1'

const localPRs: LocalPR[] = [
  {
    id: 'lpr-1', localNumber: 1, projectId, title: 'Add attempts schema + migration',
    body: '', branch: 'foundry/attempts-schema', baseBranch: 'foundry/integration-fnd-1',
    status: 'local', createdAt: '', updatedAt: '', log: [],
  },
  {
    id: 'lpr-2', localNumber: 2, projectId, title: 'Wire attempts repo + service',
    body: '', branch: 'foundry/attempts-repo', baseBranch: 'foundry/attempts-schema',
    status: 'local', createdAt: '', updatedAt: '', log: [],
    ciResult: { status: 'success', checks: [], ranAt: '', runner: 'act' },
  },
  {
    id: 'lpr-3', localNumber: 3, projectId, title: 'Attempts API handlers + tests',
    body: '', branch: 'foundry/attempts-api', baseBranch: 'foundry/attempts-repo',
    status: 'local', createdAt: '', updatedAt: '', log: [],
  },
]

const realPR: PullRequest = {
  number: 482, title: 'Attempts dashboard widget', headRefName: 'feat/attempts-widget',
  baseRefName: 'foundry/attempts-api', author: 'dev', assignees: [], requestedReviewers: [],
  createdAt: '', updatedAt: '', isDraft: false, state: 'OPEN', ciStatus: 'pending',
  labels: [], commentsCount: 0, reviews: [],
}

const foundryStack: PRStack = {
  id: 'stk-1', projectId, name: 'Simulation attempt tracking', baseBranch: 'foundry/integration-fnd-1',
  foundryId: 'fnd-1',
  entries: [
    { id: 'e1', kind: 'local', localPrId: 'lpr-1', branch: 'foundry/attempts-schema', baseBranch: 'foundry/integration-fnd-1', order: 0 },
    { id: 'e2', kind: 'local', localPrId: 'lpr-2', branch: 'foundry/attempts-repo', baseBranch: 'foundry/attempts-schema', order: 1 },
    { id: 'e3', kind: 'local', localPrId: 'lpr-3', branch: 'foundry/attempts-api', baseBranch: 'foundry/attempts-repo', order: 2 },
    { id: 'e4', kind: 'real', prNumber: 482, branch: 'feat/attempts-widget', baseBranch: 'foundry/attempts-api', order: 3 },
  ],
  publish: { status: 'idle', log: [] },
  propagation: {
    status: 'running', sourceEntryId: 'e1', currentEntryId: 'e2',
    log: [
      '12:04:01 Propagating from LOCAL-1 upward…',
      '12:04:02 LOCAL-2: merged foundry/attempts-schema cleanly → pushed.',
      '12:04:05 #482: 2 conflicted file(s) — invoking Claude.',
      '12:04:31 #482: conflicts resolved → pushed.',
    ],
  },
  createdAt: '', updatedAt: '',
}

const manualStack: PRStack = {
  id: 'stk-2', projectId, name: 'Auth refactor', baseBranch: 'main',
  entries: [], publish: { status: 'idle', log: [] }, propagation: { status: 'idle', log: [] },
  createdAt: '', updatedAt: '',
}

function stubApi(stacks: PRStack[]): void {
  const api = (window as any).api ?? {}
  ;(window as any).api = {
    ...api,
    git: { ...(api.git ?? {}), defaultBranch: async () => 'main' },
    github: { ...(api.github ?? {}), listPRs: async () => [realPR] },
    localPr: { ...(api.localPr ?? {}), list: async () => localPRs, onStateUpdate: () => () => {} },
    prStack: {
      ...(api.prStack ?? {}),
      list: async () => stacks,
      onStateUpdate: () => () => {},
      create: async () => manualStack,
      publish: async () => {},
      propagate: async () => {},
      restack: async () => {},
      reorder: async () => null,
      addEntry: async () => null,
      removeEntry: async () => null,
      rename: async () => null,
      delete: async () => {},
      merge: async () => null,
    },
  }
}

function Wrapper({ stacks, selectedStackId }: { stacks: PRStack[]; selectedStackId?: string }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    resetStores()
    setupStoresForStory({ activeProjectId: projectId })
    stubApi(stacks)
    usePRStackStore.setState({
      stacks,
      stacksCache: { [projectId]: stacks },
      currentProjectId: projectId,
      selectedStackId: selectedStackId ?? null,
      loading: false,
    })
    setReady(true)
  }, [stacks, selectedStackId])

  if (!ready) return null
  return (
    <div
      style={{
        width: 360, height: 720, background: 'var(--color-bg-secondary)',
        display: 'flex', flexDirection: 'column',
        border: '1px solid var(--color-border)', borderRadius: 4,
      }}
    >
      <PRStacksPanel />
    </div>
  )
}

const meta: Meta<typeof PRStacksPanel> = {
  title: 'PR/PRStacksPanel',
  component: PRStacksPanel,
  parameters: { layout: 'centered' },
}
export default meta
type Story = StoryObj<typeof PRStacksPanel>

export const StackList: Story = {
  render: () => <Wrapper stacks={[foundryStack, manualStack]} />,
}

export const StackDetail: Story = {
  render: () => <Wrapper stacks={[foundryStack, manualStack]} selectedStackId="stk-1" />,
}
