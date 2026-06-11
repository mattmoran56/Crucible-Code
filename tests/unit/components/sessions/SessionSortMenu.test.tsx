import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SessionSortMenu } from '../../../../src/renderer/components/sessions/SessionSortMenu'
import { useSessionViewStore } from '../../../../src/renderer/stores/sessionViewStore'

const TRIGGER = { name: 'Sort & group sessions' }

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', TRIGGER))
}

describe('SessionSortMenu', () => {
  beforeEach(() => {
    localStorage.clear()
    useSessionViewStore.setState({ sortBy: 'created', groupBy: 'none', collapsedGroups: {} })
  })

  it('renders the trigger icon button', () => {
    render(<SessionSortMenu />)
    expect(screen.getByRole('button', TRIGGER)).toBeInTheDocument()
  })

  it('keeps the menu closed initially', () => {
    render(<SessionSortMenu />)
    expect(screen.queryByText('Sort by')).not.toBeInTheDocument()
    expect(screen.queryByText('Group by')).not.toBeInTheDocument()
  })

  it('clicking the trigger opens the menu with both section headings', async () => {
    const user = userEvent.setup()
    render(<SessionSortMenu />)
    await openMenu(user)
    expect(screen.getByText('Sort by')).toBeInTheDocument()
    expect(screen.getByText('Group by')).toBeInTheDocument()
  })

  it('lists all sort and group options', async () => {
    const user = userEvent.setup()
    render(<SessionSortMenu />)
    await openMenu(user)
    // current selections carry a ✓ prefix in their accessible name
    expect(screen.getByRole('button', { name: /Created/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Name' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /None/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'PR Status' })).toBeInTheDocument()
  })

  it('checkmarks the current sort option', async () => {
    const user = userEvent.setup()
    render(<SessionSortMenu />)
    await openMenu(user)
    expect(screen.getByRole('button', { name: '✓ Created' })).toBeInTheDocument()
    // Name option has no checkmark
    expect(screen.getByRole('button', { name: 'Name' })).not.toHaveTextContent('✓')
  })

  it('checkmarks the current group option', async () => {
    const user = userEvent.setup()
    render(<SessionSortMenu />)
    await openMenu(user)
    expect(screen.getByRole('button', { name: '✓ None' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'PR Status' })).not.toHaveTextContent('✓')
  })

  it('clicking Name sets sortBy in the store', async () => {
    const user = userEvent.setup()
    render(<SessionSortMenu />)
    await openMenu(user)
    await user.click(screen.getByRole('button', { name: 'Name' }))
    expect(useSessionViewStore.getState().sortBy).toBe('name')
  })

  it('clicking PR Status sets groupBy in the store', async () => {
    const user = userEvent.setup()
    render(<SessionSortMenu />)
    await openMenu(user)
    await user.click(screen.getByRole('button', { name: 'PR Status' }))
    expect(useSessionViewStore.getState().groupBy).toBe('prStatus')
  })

  it('keeps the menu open after picking an option', async () => {
    const user = userEvent.setup()
    render(<SessionSortMenu />)
    await openMenu(user)
    await user.click(screen.getByRole('button', { name: 'Name' }))
    expect(screen.getByText('Sort by')).toBeInTheDocument()
  })

  it('moves the checkmark when the sort changes', async () => {
    const user = userEvent.setup()
    render(<SessionSortMenu />)
    await openMenu(user)
    await user.click(screen.getByRole('button', { name: 'Name' }))
    expect(screen.getByRole('button', { name: '✓ Name' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Created' })).not.toHaveTextContent('✓')
  })

  it('persists the selection to localStorage', async () => {
    const user = userEvent.setup()
    render(<SessionSortMenu />)
    await openMenu(user)
    await user.click(screen.getByRole('button', { name: 'Name' }))
    const persisted = JSON.parse(localStorage.getItem('codecrucible-session-view')!)
    expect(persisted.sortBy).toBe('name')
  })

  it('Escape closes the menu', async () => {
    const user = userEvent.setup()
    render(<SessionSortMenu />)
    await openMenu(user)
    await user.keyboard('{Escape}')
    expect(screen.queryByText('Sort by')).not.toBeInTheDocument()
  })

  it('a mousedown outside closes the menu', async () => {
    const user = userEvent.setup()
    render(<SessionSortMenu />)
    await openMenu(user)
    fireEvent.mouseDown(document.body)
    expect(screen.queryByText('Sort by')).not.toBeInTheDocument()
  })

  it('clicking the trigger again toggles the menu shut', async () => {
    const user = userEvent.setup()
    render(<SessionSortMenu />)
    await openMenu(user)
    expect(screen.getByText('Sort by')).toBeInTheDocument()
    await openMenu(user)
    expect(screen.queryByText('Sort by')).not.toBeInTheDocument()
  })

  it('uses the muted style when sort and group are the defaults', () => {
    render(<SessionSortMenu />)
    const trigger = screen.getByRole('button', TRIGGER)
    // IconButton forwards its className to the tooltip wrapper element
    expect(trigger.parentElement!.className).toContain('text-text-muted')
    expect(trigger.parentElement!.className).not.toContain('text-accent')
  })

  it('uses the accent style when a non-default sort is active', () => {
    useSessionViewStore.setState({ sortBy: 'name' })
    render(<SessionSortMenu />)
    const trigger = screen.getByRole('button', TRIGGER)
    expect(trigger.parentElement!.className).toContain('text-accent')
  })

  it('uses the accent style when a non-default grouping is active', () => {
    useSessionViewStore.setState({ groupBy: 'prStatus' })
    render(<SessionSortMenu />)
    const trigger = screen.getByRole('button', TRIGGER)
    expect(trigger.parentElement!.className).toContain('text-accent')
  })

  it('reflects store state set before opening the menu', async () => {
    const user = userEvent.setup()
    useSessionViewStore.setState({ sortBy: 'name', groupBy: 'prStatus' })
    render(<SessionSortMenu />)
    await openMenu(user)
    expect(screen.getByRole('button', { name: '✓ Name' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '✓ PR Status' })).toBeInTheDocument()
  })
})
