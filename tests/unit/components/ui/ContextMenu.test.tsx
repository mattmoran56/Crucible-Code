import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useContextMenu, type ContextMenuItem } from '../../../../src/renderer/components/ui/ContextMenu'

function Harness({ items }: { items: ContextMenuItem[] }) {
  const { onContextMenu, menu } = useContextMenu()
  return (
    <>
      <div data-testid="target" onContextMenu={(e) => onContextMenu(e, items)}>
        Right-click me
      </div>
      {menu}
    </>
  )
}

describe('useContextMenu', () => {
  it('does not render the menu by default', () => {
    render(<Harness items={[{ label: 'A', onClick: () => {} }]} />)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('opens the menu on right-click', async () => {
    const user = userEvent.setup()
    render(<Harness items={[{ label: 'Copy', onClick: () => {} }]} />)
    await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId('target') })
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Copy' })).toBeInTheDocument()
  })

  it('clicking an item fires onClick and closes the menu', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<Harness items={[{ label: 'Copy', onClick }]} />)
    await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId('target') })
    await user.click(screen.getByRole('menuitem', { name: 'Copy' }))
    expect(onClick).toHaveBeenCalled()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('disabled items are non-interactive and do not fire onClick', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<Harness items={[{ label: 'Disabled', onClick, disabled: true }]} />)
    await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId('target') })
    const item = screen.getByRole('menuitem', { name: 'Disabled' })
    expect(item).toBeDisabled()
    await user.click(item)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('Escape closes the menu', async () => {
    const user = userEvent.setup()
    render(<Harness items={[{ label: 'X', onClick: () => {} }]} />)
    await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId('target') })
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('does nothing when the items list is empty', async () => {
    const user = userEvent.setup()
    render(<Harness items={[]} />)
    await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId('target') })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('renders a separator after items flagged with separatorAfter', async () => {
    const user = userEvent.setup()
    render(
      <Harness
        items={[
          { label: 'A', onClick: () => {}, separatorAfter: true },
          { label: 'B', onClick: () => {} },
        ]}
      />
    )
    await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId('target') })
    expect(screen.getByRole('separator')).toBeInTheDocument()
  })
})
