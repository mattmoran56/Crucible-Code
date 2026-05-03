import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ListBox, ListItem } from '../../../../src/renderer/components/ui/ListBox'

describe('ListBox', () => {
  it('exposes itself as a listbox with the supplied label', () => {
    render(
      <ListBox label="Sessions">
        <ListItem>a</ListItem>
        <ListItem>b</ListItem>
      </ListBox>
    )
    expect(screen.getByRole('listbox', { name: 'Sessions' })).toBeInTheDocument()
  })

  it('renders each child as an option', () => {
    render(
      <ListBox label="Sessions">
        <ListItem>a</ListItem>
        <ListItem>b</ListItem>
        <ListItem>c</ListItem>
      </ListBox>
    )
    expect(screen.getAllByRole('option')).toHaveLength(3)
  })

  it('marks the selected item with aria-selected', () => {
    render(
      <ListBox label="Sessions">
        <ListItem selected>a</ListItem>
        <ListItem>b</ListItem>
      </ListBox>
    )
    const items = screen.getAllByRole('option')
    expect(items[0]).toHaveAttribute('aria-selected', 'true')
    expect(items[1]).toHaveAttribute('aria-selected', 'false')
  })

  it('calls onSelect with the index when Enter is pressed on a focused item', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <ListBox label="Sessions" onSelect={onSelect}>
        <ListItem>a</ListItem>
        <ListItem>b</ListItem>
      </ListBox>
    )
    const items = screen.getAllByRole('option')
    items[0].focus()
    await user.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledWith(0)
  })
})
