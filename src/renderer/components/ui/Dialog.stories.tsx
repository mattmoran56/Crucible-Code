import React from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { Dialog } from './Dialog'
import { Button } from './Button'
import { Input } from './Input'

const meta: Meta<typeof Dialog> = {
  title: 'UI/Dialog',
  component: Dialog,
  parameters: { layout: 'centered' },
}
export default meta

type Story = StoryObj<typeof Dialog>

export const Default: Story = {
  args: {
    open: true,
    onClose: () => {},
    title: 'Create New Session',
    children: (
      <div>
        <Input label="Session name" placeholder="fix-auth-bug" className="mb-4" />
        <div className="flex gap-3 justify-end">
          <Button variant="ghost" size="sm">Cancel</Button>
          <Button variant="primary" size="sm">Create</Button>
        </div>
      </div>
    ),
  },
}

export const Confirmation: Story = {
  args: {
    open: true,
    onClose: () => {},
    title: 'Delete session?',
    children: (
      <div>
        <p className="text-xs text-text-muted mb-5">
          This will remove the worktree and branch for <strong className="text-text">fix-auth-bug</strong>. This cannot be undone.
        </p>
        <div className="flex gap-3 justify-end">
          <Button variant="ghost" size="sm">Cancel</Button>
          <Button variant="danger" size="sm">Delete</Button>
        </div>
      </div>
    ),
  },
}
