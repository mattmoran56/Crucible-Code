import type { Meta, StoryObj } from '@storybook/react'
import { ThemeRadioList, ThemePicker } from './ThemePicker'

const meta: Meta = {
  title: 'Remote/Theme',
  parameters: { layout: 'centered' },
}
export default meta

type Story = StoryObj

export const RadioList: Story = {
  render: () => (
    <div className="w-72 bg-bg-secondary border border-border rounded-md overflow-hidden">
      <ThemeRadioList />
    </div>
  ),
}

export const Dropdown: Story = {
  render: () => (
    <div className="p-3 bg-bg-tertiary border border-border rounded inline-flex">
      <ThemePicker />
    </div>
  ),
}
