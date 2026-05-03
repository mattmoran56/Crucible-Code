import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IconButton } from '../../../../src/renderer/components/ui/IconButton'

describe('IconButton', () => {
  it('uses the label as the accessible name', () => {
    render(<IconButton label="Refresh">↻</IconButton>)
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument()
  })

  it('fires onClick when clicked', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<IconButton label="Click" onClick={onClick}>+</IconButton>)
    await user.click(screen.getByRole('button', { name: 'Click' }))
    expect(onClick).toHaveBeenCalled()
  })

  it('applies the danger variant class', () => {
    render(<IconButton label="Delete" variant="danger">×</IconButton>)
    expect(screen.getByRole('button', { name: 'Delete' }).className).toMatch(/text-danger/)
  })

  it('respects size sm vs md', () => {
    const { rerender } = render(<IconButton label="x" size="sm">x</IconButton>)
    expect(screen.getByRole('button').className).toMatch(/w-6/)
    rerender(<IconButton label="x" size="md">x</IconButton>)
    expect(screen.getByRole('button').className).toMatch(/w-8/)
  })

  it('forwards extra HTML attributes to the button', () => {
    render(<IconButton label="x" data-testid="ic">x</IconButton>)
    expect(screen.getByTestId('ic')).toBeInTheDocument()
  })
})
