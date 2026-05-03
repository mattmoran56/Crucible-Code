import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Tooltip } from '../../../../src/renderer/components/ui/Tooltip'

describe('Tooltip', () => {
  it('renders children directly', () => {
    render(
      <Tooltip content="hi">
        <button>Click me</button>
      </Tooltip>
    )
    expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument()
  })

  it('shows the tooltip on hover and hides on leave', async () => {
    const user = userEvent.setup()
    render(
      <Tooltip content="Helpful tip">
        <button>Click me</button>
      </Tooltip>
    )
    expect(screen.queryByText('Helpful tip')).not.toBeInTheDocument()
    await user.hover(screen.getByRole('button', { name: 'Click me' }))
    expect(screen.getByText('Helpful tip')).toBeInTheDocument()
    await user.unhover(screen.getByRole('button', { name: 'Click me' }))
    expect(screen.queryByText('Helpful tip')).not.toBeInTheDocument()
  })

  it.each(['top', 'bottom', 'left'] as const)('accepts side prop %s without crashing', async (side) => {
    const user = userEvent.setup()
    render(
      <Tooltip content="x" side={side}>
        <button>btn</button>
      </Tooltip>
    )
    await user.hover(screen.getByRole('button'))
    expect(screen.getByText('x')).toBeInTheDocument()
  })
})
