import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { MobileNav, HamburgerButton } from './MobileNav'

const meta: Meta<typeof MobileNav> = {
  title: 'Remote/MobileNav',
  component: MobileNav,
  parameters: { layout: 'fullscreen' },
}
export default meta

type Story = StoryObj<typeof meta>

const projects = [
  { id: 'a', name: 'redeployable-monorepo' },
  { id: 'b', name: 'CodeCrucible' },
  { id: 'c', name: 'WeWipe' },
]

const sessions = [
  { id: 's1', name: 'testing', branchName: 'session/testing' },
  { id: 's2', name: 'auth-refactor', branchName: 'session/auth-refactor' },
]

export const Open: Story = {
  render: () => {
    const [open, setOpen] = useState(true)
    const [project, setProject] = useState('a')
    const [session, setSession] = useState<string | null>(null)
    const [settingsOpen, setSettingsOpen] = useState(false)
    return (
      <div className="h-screen bg-bg text-text flex flex-col">
        <header className="flex items-center h-14 bg-bg-tertiary border-b border-border">
          <HamburgerButton onClick={() => setOpen(true)} />
          <span className="text-base font-semibold ml-2">Crucible Code</span>
        </header>
        <main className="flex-1 flex items-center justify-center text-text-muted text-sm">
          (workspace)
        </main>
        <MobileNav
          open={open}
          onClose={() => setOpen(false)}
          projects={projects}
          activeProjectId={project}
          onSelectProject={(id) => setProject(id)}
          sessions={sessions}
          activeSessionId={session}
          settingsOpen={settingsOpen}
          onSelectSession={(id) => { setSession(id); setSettingsOpen(false); setOpen(false) }}
          onOpenSettings={() => { setSession(null); setSettingsOpen(true); setOpen(false) }}
        />
      </div>
    )
  },
}

export const Closed: Story = {
  render: () => (
    <div className="h-screen bg-bg text-text flex flex-col">
      <header className="flex items-center h-14 bg-bg-tertiary border-b border-border">
        <HamburgerButton onClick={() => {}} />
        <span className="text-base font-semibold ml-2">Crucible Code</span>
      </header>
      <main className="flex-1 flex items-center justify-center text-text-muted text-sm">
        Tap the hamburger to open the drawer.
      </main>
      <MobileNav
        open={false}
        onClose={() => {}}
        projects={projects}
        activeProjectId="a"
        onSelectProject={() => {}}
        sessions={sessions}
        activeSessionId={null}
        settingsOpen={false}
        onSelectSession={() => {}}
        onOpenSettings={() => {}}
      />
    </div>
  ),
}
