import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DropdownMenu } from '../../../../src/renderer/components/ui/DropdownMenu'

describe('DropdownMenu', () => {
  it('renders the trigger but no menu by default', () => {
    render(
      <DropdownMenu items={[{ label: 'A', onClick: () => {} }]}>
        <button>Open</button>
      </DropdownMenu>
    )
    expect(screen.getByRole('button', { name: 'Open' })).toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('opens the menu on trigger click and closes on second click', async () => {
    const user = userEvent.setup()
    render(
      <DropdownMenu items={[{ label: 'A', onClick: () => {} }, { label: 'B', onClick: () => {} }]}>
        <button>Open</button>
      </DropdownMenu>
    )
    await user.click(screen.getByRole('button', { name: 'Open' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'A' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Open' }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('fires the matching onClick and closes the menu', async () => {
    const user = userEvent.setup()
    const a = vi.fn()
    const b = vi.fn()
    render(
      <DropdownMenu items={[{ label: 'A', onClick: a }, { label: 'B', onClick: b }]}>
        <button>Open</button>
      </DropdownMenu>
    )
    await user.click(screen.getByRole('button', { name: 'Open' }))
    await user.click(screen.getByRole('menuitem', { name: 'B' }))
    expect(b).toHaveBeenCalled()
    expect(a).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('Escape closes the menu', async () => {
    const user = userEvent.setup()
    render(
      <DropdownMenu items={[{ label: 'A', onClick: () => {} }]}>
        <button>Open</button>
      </DropdownMenu>
    )
    await user.click(screen.getByRole('button', { name: 'Open' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('applies the danger variant class to dangerous items', async () => {
    const user = userEvent.setup()
    render(
      <DropdownMenu items={[{ label: 'Delete', variant: 'danger', onClick: () => {} }]}>
        <button>Open</button>
      </DropdownMenu>
    )
    await user.click(screen.getByRole('button', { name: 'Open' }))
    expect(screen.getByRole('menuitem', { name: 'Delete' }).className).toMatch(/text-danger/)
  })
})
