import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Dialog } from '../../../../src/renderer/components/ui/Dialog'

describe('Dialog', () => {
  it('renders nothing when closed', () => {
    render(<Dialog open={false} onClose={() => {}} title="Hi"><div>body</div></Dialog>)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders title and children when open', () => {
    render(<Dialog open onClose={() => {}} title="Are you sure?"><div>body</div></Dialog>)
    expect(screen.getByRole('dialog', { name: 'Are you sure?' })).toBeInTheDocument()
    expect(screen.getByText('body')).toBeInTheDocument()
  })

  it('calls onClose when the backdrop is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<Dialog open onClose={onClose} title="x"><div>body</div></Dialog>)
    // Backdrop is the absolutely-positioned aria-hidden div
    const backdrop = document.querySelector('div[aria-hidden="true"]')!
    await user.click(backdrop as Element)
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose when Escape is pressed inside the panel', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<Dialog open onClose={onClose} title="x"><input data-testid="i" /></Dialog>)
    screen.getByTestId('i').focus()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('honours the width prop via inline style on the panel', () => {
    render(<Dialog open onClose={() => {}} title="x" width="40rem"><div>body</div></Dialog>)
    expect(screen.getByRole('dialog')).toHaveStyle({ width: '40rem' })
  })
})
