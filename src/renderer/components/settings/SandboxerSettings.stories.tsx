import type { Meta, StoryObj } from '@storybook/react'
import { useEffect, useState } from 'react'
import { SandboxerSettings } from './SandboxerSettings'
import { resetStores, setupStoresForStory } from '../../stories/helpers/storeSetup'
import { mockProjects } from '@mock/mockData'
import type { Project, SandboxerConfigCheck } from '../../../shared/types'

function Wrapper({ project, check }: { project: Project; check: SandboxerConfigCheck }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    resetStores()
    setupStoresForStory()
    const api = (window as any).api
    ;(window as any).api = { ...api, sandboxer: { ...api.sandboxer, checkConfig: async () => check } }
    setReady(true)
  }, [check])
  if (!ready) return null
  return (
    <div className="bg-bg" style={{ padding: 24, width: 640 }}>
      <SandboxerSettings project={project} />
    </div>
  )
}

const meta: Meta<typeof Wrapper> = {
  title: 'Settings/SandboxerSettings',
  component: Wrapper,
}
export default meta
type Story = StoryObj<typeof Wrapper>

const base = mockProjects[0]

/** On, with a config kept out of git at the repo root (the redeployable setup). */
export const Enabled: Story = {
  args: {
    project: { ...base, sandboxer: { enabled: true } },
    check: { path: `${base.repoPath}/sandboxer.yaml`, exists: true, gitState: 'ignored', cliVersion: '0.1.0' },
  },
}

/** On, but neither the config nor the CLI can be found. */
export const Missing: Story = {
  args: {
    project: { ...base, sandboxer: { enabled: true, configPath: 'ops/sandboxer.yaml' } },
    check: { path: `${base.repoPath}/ops/sandboxer.yaml`, exists: false, gitState: 'unknown', cliVersion: null },
  },
}

/** Off — the default. */
export const Disabled: Story = {
  args: { project: base, check: { path: '', exists: false, gitState: 'unknown', cliVersion: null } },
}
