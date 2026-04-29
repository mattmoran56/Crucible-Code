import type { Meta, StoryObj } from '@storybook/react'
import { SuggestionBlock } from './SuggestionBlock'

const meta: Meta<typeof SuggestionBlock> = {
  title: 'PR/SuggestionBlock',
  component: SuggestionBlock,
  parameters: { layout: 'centered' },
  decorators: [(Story) => <div style={{ width: 520 }}><Story /></div>],
}
export default meta

type Story = StoryObj<typeof SuggestionBlock>

export const SingleLine: Story = {
  args: {
    text: 'const fooBar = 42 // renamed from foo_bar',
    author: 'alice',
    startLine: 12,
    endLine: 12,
    onApply: async () => {},
  },
}

export const MultiLine: Story = {
  args: {
    text: 'function add(a: number, b: number): number {\n  return a + b\n}',
    author: 'bob',
    startLine: 50,
    endLine: 53,
    onApply: async () => {},
  },
}

export const BranchNotCheckedOut: Story = {
  args: {
    text: 'const x = 1',
    author: 'carol',
    startLine: 5,
    endLine: 5,
    onApply: undefined,
  },
}
