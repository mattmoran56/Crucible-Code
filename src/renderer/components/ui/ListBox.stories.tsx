import React, { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { ListBox, ListItem } from './ListBox'

const meta: Meta<typeof ListBox> = {
  title: 'UI/ListBox',
  component: ListBox,
  parameters: { layout: 'centered' },
}
export default meta

type Story = StoryObj<typeof ListBox>

function ListBoxDemo() {
  const [selected, setSelected] = useState(0)
  const items = [
    'Add PR review panel',
    'Fix terminal resize',
    'Add syntax highlighting',
    'Implement session indicators',
    'Add notification badges',
  ]
  return (
    <div style={{ width: 280 }}>
      <ListBox label="Commit list" onSelect={setSelected}>
        {items.map((item, i) => (
          <ListItem
            key={item}
            selected={i === selected}
            onClick={() => setSelected(i)}
            style={{ padding: '6px 12px', fontSize: 12 }}
          >
            {item}
          </ListItem>
        ))}
      </ListBox>
    </div>
  )
}

export const Default: Story = {
  render: () => <ListBoxDemo />,
}
