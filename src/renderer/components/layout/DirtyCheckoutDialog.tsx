import React from 'react'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'

interface DirtyCheckoutDialogProps {
  open: boolean
  /** Branch the user is switching to (for the message). */
  targetBranch: string
  /** Branch the user is switching from. */
  fromBranch: string
  onCancel: () => void
  onLeave: () => void
  onCarry: () => void
  busy?: boolean
}

export function DirtyCheckoutDialog({
  open,
  targetBranch,
  fromBranch,
  onCancel,
  onLeave,
  onCarry,
  busy,
}: DirtyCheckoutDialogProps) {
  return (
    <Dialog open={open} onClose={busy ? () => {} : onCancel} title="Switch branch with uncommitted changes" width="30rem">
      <p className="text-text text-xs" style={{ marginBottom: 8 }}>
        You have uncommitted changes on{' '}
        <span className="font-mono text-accent">{fromBranch}</span>. Switching to{' '}
        <span className="font-mono text-accent">{targetBranch}</span> — what should happen to them?
      </p>
      <ul className="text-text-muted text-[11px]" style={{ marginBottom: 16, paddingLeft: 14, listStyle: 'disc' }}>
        <li>
          <strong className="text-text">Leave them here</strong> stashes your changes on{' '}
          <span className="font-mono">{fromBranch}</span> — restore later with <code>git stash pop</code>.
        </li>
        <li>
          <strong className="text-text">Bring them with me</strong> carries your changes onto{' '}
          <span className="font-mono">{targetBranch}</span>. Git will refuse if they would overwrite tracked files there.
        </li>
      </ul>
      <div className="flex justify-end gap-2 flex-wrap">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button variant="ghost" size="sm" onClick={onLeave} loading={busy}>
          Leave changes here
        </Button>
        <Button variant="primary" size="sm" onClick={onCarry} loading={busy}>
          Bring them with me
        </Button>
      </div>
    </Dialog>
  )
}
