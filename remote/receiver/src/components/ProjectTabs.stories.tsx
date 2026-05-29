import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { ProjectTabs } from './ProjectTabs'

const meta: Meta<typeof ProjectTabs> = {
  title: 'Remote/ProjectTabs',
  component: ProjectTabs,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="h-11 bg-bg-tertiary border-b border-border">
        <Story />
      </div>
    ),
  ],
}
export default meta

type Story = StoryObj<typeof meta>

const projects = [
  { id: 'a', name: 'redeployable-monorepo' },
  { id: 'b', name: 'CodeCrucible' },
  { id: 'c', name: 'WeWipe' },
]

export const Default: Story = {
  render: () => {
    const [active, setActive] = useState('a')
    return <ProjectTabs projects={projects} activeProjectId={active} onSelect={setActive} />
  },
}

export const SingleProject: Story = {
  args: {
    projects: [{ id: 'a', name: 'redeployable-monorepo' }],
    activeProjectId: 'a',
    onSelect: () => {},
  },
}

export const Empty: Story = {
  args: { projects: [], activeProjectId: null, onSelect: () => {} },
}
