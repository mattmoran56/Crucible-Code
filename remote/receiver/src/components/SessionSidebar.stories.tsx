import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { SessionSidebar } from './SessionSidebar'

const meta: Meta<typeof SessionSidebar> = {
  title: 'Remote/SessionSidebar',
  component: SessionSidebar,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="h-screen bg-bg flex">
        <Story />
      </div>
    ),
  ],
}
export default meta

type Story = StoryObj<typeof meta>

const sessions = [
  { id: 's1', name: 'testing', branchName: 'session/testing' },
  { id: 's2', name: 'auth-refactor', branchName: 'session/auth-refactor' },
  { id: 's3', name: 'fix-flaky-test' },
]

export const Default: Story = {
  render: () => {
    const [active, setActive] = useState<string | null>('s1')
    const [settingsOpen, setSettingsOpen] = useState(false)
    return (
      <SessionSidebar
        sessions={sessions}
        activeSessionId={active}
        settingsOpen={settingsOpen}
        onSelectSession={(id) => { setActive(id); setSettingsOpen(false) }}
        onOpenSettings={() => { setActive(null); setSettingsOpen(true) }}
      />
    )
  },
}

export const Loading: Story = {
  args: {
    sessions: null,
    activeSessionId: null,
    settingsOpen: false,
    onSelectSession: () => {},
    onOpenSettings: () => {},
  },
}

export const Empty: Story = {
  args: {
    sessions: [],
    activeSessionId: null,
    settingsOpen: false,
    onSelectSession: () => {},
    onOpenSettings: () => {},
  },
}

export const SettingsActive: Story = {
  args: {
    sessions,
    activeSessionId: null,
    settingsOpen: true,
    onSelectSession: () => {},
    onOpenSettings: () => {},
  },
}
