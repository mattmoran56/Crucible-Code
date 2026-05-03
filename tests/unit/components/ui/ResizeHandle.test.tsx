import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ResizeHandle } from '../../../../src/renderer/components/ui/ResizeHandle'

describe('ResizeHandle', () => {
  it('renders as a separator with the right orientation for horizontal', () => {
    render(<ResizeHandle direction="horizontal" onMouseDown={() => {}} />)
    const sep = screen.getByRole('separator')
    expect(sep).toHaveAttribute('aria-orientation', 'vertical')
  })

  it('uses horizontal aria-orientation for a vertical drag handle', () => {
    render(<ResizeHandle direction="vertical" onMouseDown={() => {}} />)
    const sep = screen.getByRole('separator')
    expect(sep).toHaveAttribute('aria-orientation', 'horizontal')
  })

  it('fires onMouseDown', () => {
    const onMouseDown = vi.fn()
    render(<ResizeHandle direction="horizontal" onMouseDown={onMouseDown} />)
    screen.getByRole('separator').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(onMouseDown).toHaveBeenCalled()
  })

  it('is keyboard-focusable', async () => {
    const user = userEvent.setup()
    render(<ResizeHandle direction="horizontal" onMouseDown={() => {}} />)
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('separator'))
  })
})
