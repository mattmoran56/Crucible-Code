import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DirtyCheckoutDialog } from '../../../../src/renderer/components/layout/DirtyCheckoutDialog'

const noop = () => {}

function renderDialog(overrides: Partial<React.ComponentProps<typeof DirtyCheckoutDialog>> = {}) {
  return render(
    <DirtyCheckoutDialog
      open
      targetBranch="feature/login"
      fromBranch="main"
      onCancel={noop}
      onLeave={noop}
      onCarry={noop}
      {...overrides}
    />
  )
}

describe('DirtyCheckoutDialog', () => {
  it('renders nothing when open is false', () => {
    renderDialog({ open: false })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders a modal dialog titled "Switch branch with uncommitted changes"', () => {
    renderDialog()
    const dialog = screen.getByRole('dialog', { name: 'Switch branch with uncommitted changes' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
  })

  it('mentions both the from and target branch names in the message', () => {
    renderDialog({ fromBranch: 'develop', targetBranch: 'hotfix/oops' })
    // Branch names appear in the intro paragraph and the explanation bullets.
    expect(screen.getAllByText('develop').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('hotfix/oops').length).toBeGreaterThanOrEqual(1)
  })

  it('clicking Cancel fires onCancel', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    renderDialog({ onCancel })
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('clicking "Leave changes here" fires onLeave', async () => {
    const user = userEvent.setup()
    const onLeave = vi.fn()
    renderDialog({ onLeave })
    await user.click(screen.getByRole('button', { name: 'Leave changes here' }))
    expect(onLeave).toHaveBeenCalledTimes(1)
  })

  it('clicking "Bring them with me" fires onCarry', async () => {
    const user = userEvent.setup()
    const onCarry = vi.fn()
    renderDialog({ onCarry })
    await user.click(screen.getByRole('button', { name: 'Bring them with me' }))
    expect(onCarry).toHaveBeenCalledTimes(1)
  })

  it('disables Cancel and shows loading on action buttons while busy', () => {
    renderDialog({ busy: true })
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    // Both loading buttons render the Button component's "Loading..." text.
    const loading = screen.getAllByRole('button', { name: 'Loading...' })
    expect(loading).toHaveLength(2)
    loading.forEach((btn) => expect(btn).toBeDisabled())
  })

  it('pressing Escape inside the dialog calls onCancel when not busy', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    renderDialog({ onCancel })
    screen.getByRole('button', { name: 'Cancel' }).focus()
    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalled()
  })

  it('pressing Escape while busy does not call onCancel', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    renderDialog({ onCancel, busy: true })
    screen.getByRole('dialog').focus()
    await user.keyboard('{Escape}')
    expect(onCancel).not.toHaveBeenCalled()
  })
})
