import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRovingIndex } from '../../../src/renderer/hooks/useRovingIndex'

function List({
  itemCount,
  orientation,
  loop = true,
  onSelect,
}: {
  itemCount: number
  orientation: 'horizontal' | 'vertical'
  loop?: boolean
  onSelect?: (i: number) => void
}) {
  const { activeIndex, getItemProps } = useRovingIndex({ itemCount, orientation, loop, onSelect })
  return (
    <ul>
      {Array.from({ length: itemCount }).map((_, i) => (
        <li
          key={i}
          {...(getItemProps(i) as any)}
          data-testid={`item-${i}`}
          data-active={activeIndex === i ? 'yes' : 'no'}
        >
          item {i}
        </li>
      ))}
    </ul>
  )
}

describe('useRovingIndex', () => {
  it('only the active item has tabIndex=0', () => {
    render(<List itemCount={3} orientation="vertical" />)
    expect(screen.getByTestId('item-0')).toHaveAttribute('tabindex', '0')
    expect(screen.getByTestId('item-1')).toHaveAttribute('tabindex', '-1')
    expect(screen.getByTestId('item-2')).toHaveAttribute('tabindex', '-1')
  })

  it('arrow down advances the active index for vertical lists', async () => {
    const user = userEvent.setup()
    render(<List itemCount={3} orientation="vertical" />)
    const first = screen.getByTestId('item-0')
    first.focus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByTestId('item-1')).toHaveAttribute('data-active', 'yes')
  })

  it('arrow up before first wraps to last when loop=true', async () => {
    const user = userEvent.setup()
    render(<List itemCount={3} orientation="vertical" loop />)
    screen.getByTestId('item-0').focus()
    await user.keyboard('{ArrowUp}')
    expect(screen.getByTestId('item-2')).toHaveAttribute('data-active', 'yes')
  })

  it('arrow up before first stays at 0 when loop=false', async () => {
    const user = userEvent.setup()
    render(<List itemCount={3} orientation="vertical" loop={false} />)
    screen.getByTestId('item-0').focus()
    await user.keyboard('{ArrowUp}')
    expect(screen.getByTestId('item-0')).toHaveAttribute('data-active', 'yes')
  })

  it('arrow right advances for horizontal lists, left retreats', async () => {
    const user = userEvent.setup()
    render(<List itemCount={3} orientation="horizontal" />)
    screen.getByTestId('item-0').focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByTestId('item-1')).toHaveAttribute('data-active', 'yes')
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByTestId('item-0')).toHaveAttribute('data-active', 'yes')
  })

  it('Home/End jump to the first/last item', async () => {
    const user = userEvent.setup()
    render(<List itemCount={5} orientation="vertical" />)
    screen.getByTestId('item-0').focus()
    await user.keyboard('{End}')
    expect(screen.getByTestId('item-4')).toHaveAttribute('data-active', 'yes')
    await user.keyboard('{Home}')
    expect(screen.getByTestId('item-0')).toHaveAttribute('data-active', 'yes')
  })

  it('Enter and Space fire onSelect', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<List itemCount={3} orientation="vertical" onSelect={onSelect} />)
    screen.getByTestId('item-0').focus()
    await user.keyboard('{Enter}')
    await user.keyboard(' ')
    expect(onSelect).toHaveBeenCalledTimes(2)
    expect(onSelect).toHaveBeenCalledWith(0)
  })
})
