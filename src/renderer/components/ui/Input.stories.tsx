import type { Meta, StoryObj } from '@storybook/react'
import { Input } from './Input'

const meta: Meta<typeof Input> = {
  title: 'UI/Input',
  component: Input,
  parameters: { layout: 'centered' },
}
export default meta

type Story = StoryObj<typeof Input>

export const Default: Story = {
  args: { label: 'Session name', placeholder: 'fix-auth-bug' },
  decorators: [(Story) => <div style={{ width: 300 }}><Story /></div>],
}

export const WithHint: Story = {
  args: { label: 'Session name', placeholder: 'fix-auth-bug', hint: 'Branch will be created as session/<name>' },
  decorators: [(Story) => <div style={{ width: 300 }}><Story /></div>],
}

export const WithError: Story = {
  args: { label: 'Session name', value: 'invalid name!', error: 'Name must be a valid git branch segment' },
  decorators: [(Story) => <div style={{ width: 300 }}><Story /></div>],
}
