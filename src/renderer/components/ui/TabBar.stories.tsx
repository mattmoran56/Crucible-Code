import React, { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { TabBar, Tab } from './TabBar'

const meta: Meta<typeof TabBar> = {
  title: 'UI/TabBar',
  component: TabBar,
  parameters: { layout: 'centered' },
}
export default meta

type Story = StoryObj<typeof TabBar>

function TabBarDemo() {
  const [active, setActive] = useState(0)
  const tabs = ['Agent', 'Git', 'PR Review']
  return (
    <div style={{ height: 36, background: 'var(--color-bg-tertiary)' }}>
      <TabBar label="Workspace tabs">
        {tabs.map((t, i) => (
          <Tab key={t} active={i === active} onClick={() => setActive(i)} style={{ padding: '0 16px' }}>
            {t}
          </Tab>
        ))}
      </TabBar>
    </div>
  )
}

export const Default: Story = {
  render: () => <TabBarDemo />,
}
