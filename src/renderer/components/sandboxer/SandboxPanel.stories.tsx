import type { Meta, StoryObj } from '@storybook/react'
import { useEffect, useState } from 'react'
import { SandboxPanel } from './SandboxPanel'
import { resetStores, setupStoresForStory } from '../../stories/helpers/storeSetup'
import { useProjectStore } from '../../stores/projectStore'
import type { SandboxInfo, SandboxJob, SandboxLinkState } from '../../../shared/types'

const host = (label: string) => `https://new-feature--${label}--acme.sbx.localhost`

function sandbox(state: string, links: Record<string, SandboxLinkState>): SandboxInfo {
  return {
    project: 'acme',
    slug: 'new-feature',
    branch: 'session/new-feature',
    worktree: '/mock/worktree',
    state,
    container: 'sandboxer-acme-new-feature',
    urls: Object.fromEntries(Object.keys(links).map((label) => [label, host(label)])),
    links,
  }
}

const buildingJob: SandboxJob = {
  worktreePath: '/mock/worktree',
  title: 'Starting sandbox',
  state: 'running',
  step: 'Starting new-feature from session/new-feature@99ec052',
  startedAt: new Date(Date.now() - 154_000).toISOString(),
  lines: [
    '$ sandboxer up',
    '==> Seeding: forking acme_db from the local container',
    '==> Building sandboxer/acme:f6eb644f49b7',
    '#12 [deps 3/4] RUN npm ci --prefer-offline',
    '#12 DONE 48.2s',
    '==> Built sandboxer/acme:f6eb644f49b7',
    '==> Starting new-feature from session/new-feature@99ec052',
  ],
}

interface Setup {
  sandboxes: SandboxInfo[]
  job?: SandboxJob
}

function Wrapper({ setup }: { setup: Setup }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    resetStores()
    setupStoresForStory()
    const { projects } = useProjectStore.getState()
    useProjectStore.setState({
      projects: projects.map((p, i) => (i === 0 ? { ...p, sandboxer: { enabled: true } } : p)),
    })
    const api = (window as any).api
    ;(window as any).api = {
      ...api,
      sandboxer: {
        ...api.sandboxer,
        status: async () => setup.sandboxes,
        job: async () => setup.job ?? null,
        onJobEvent: () => () => {},
      },
    }
    setReady(true)
  }, [setup])
  if (!ready) return null
  return (
    <div className="h-screen flex flex-col bg-bg-secondary border-l border-border" style={{ width: 340 }}>
      <div className="border-b border-border" style={{ padding: '10px 12px' }}>
        <span className="text-xs font-medium text-text-muted uppercase tracking-wide">Sandbox</span>
      </div>
      <SandboxPanel />
    </div>
  )
}

const meta: Meta<typeof Wrapper> = {
  title: 'Sandboxer/SandboxPanel',
  component: Wrapper,
  parameters: { layout: 'fullscreen' },
}
export default meta
type Story = StoryObj<typeof Wrapper>

/** A running sandbox: some apps answer, one is still starting, one is not built. */
export const LinksWithReadiness: Story = {
  args: {
    setup: {
      sandboxes: [
        sandbox('running', {
          app: 'ready',
          admin: 'ready',
          www: 'starting',
          storybook: 'not-built',
          api: 'ready',
          'admin-api': 'ready',
        }),
      ],
    },
  },
}

/** `sandboxer up` in progress: the panel shows the step and output itself. */
export const Building: Story = {
  args: {
    setup: {
      job: buildingJob,
      sandboxes: [
        sandbox('starting', { app: 'starting', admin: 'starting', api: 'starting', 'admin-api': 'starting' }),
      ],
    },
  },
}

/** No sandbox yet for this session. */
export const Empty: Story = {
  args: { setup: { sandboxes: [] } },
}
