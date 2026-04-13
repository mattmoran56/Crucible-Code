import type { Meta, StoryObj } from '@storybook/react'
import { Button } from './Button'

const meta: Meta<typeof Button> = {
  title: 'UI/Button',
  component: Button,
  parameters: { layout: 'centered' },
  argTypes: {
    variant: { control: 'select', options: ['primary', 'ghost', 'danger'] },
    size: { control: 'select', options: ['sm', 'md'] },
  },
}
export default meta

type Story = StoryObj<typeof Button>

export const Primary: Story = { args: { children: 'Create Session', variant: 'primary' } }
export const Ghost: Story = { args: { children: 'Cancel', variant: 'ghost' } }
export const Danger: Story = { args: { children: 'Delete', variant: 'danger' } }
export const Loading: Story = { args: { children: 'Creating...', variant: 'primary', loading: true } }
export const Small: Story = { args: { children: 'Push', variant: 'primary', size: 'sm' } }
export const Disabled: Story = { args: { children: 'Disabled', variant: 'primary', disabled: true } }
