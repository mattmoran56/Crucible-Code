import { describe, expect, it } from 'vitest'
import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useFocusTrap } from '../../../src/renderer/hooks/useFocusTrap'

function Modal({ active, n = 3 }: { active: boolean; n?: number }) {
  const ref = useFocusTrap(active)
  return (
    <div ref={ref} tabIndex={-1} data-testid="container">
      {Array.from({ length: n }).map((_, i) => (
        <button key={i} data-testid={`btn-${i}`}>btn {i}</button>
      ))}
    </div>
  )
}

describe('useFocusTrap', () => {
  it('focuses the first focusable element when active', () => {
    render(<Modal active={true} />)
    expect(document.activeElement).toBe(screen.getByTestId('btn-0'))
  })

  it('Tab from the last item wraps to the first', async () => {
    const user = userEvent.setup()
    render(<Modal active={true} n={3} />)
    const last = screen.getByTestId('btn-2')
    last.focus()
    await user.tab()
    expect(document.activeElement).toBe(screen.getByTestId('btn-0'))
  })

  it('Shift+Tab from the first item wraps to the last', async () => {
    const user = userEvent.setup()
    render(<Modal active={true} n={3} />)
    const first = screen.getByTestId('btn-0')
    first.focus()
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(screen.getByTestId('btn-2'))
  })

  it('does not auto-focus when inactive', () => {
    render(
      <>
        <button data-testid="outside">outside</button>
        <Modal active={false} />
      </>
    )
    ;(screen.getByTestId('outside') as HTMLElement).focus()
    expect(document.activeElement).toBe(screen.getByTestId('outside'))
  })

  it('focuses the container itself when there are no focusable children', () => {
    function EmptyModal() {
      const ref = useFocusTrap(true)
      return <div ref={ref} tabIndex={-1} data-testid="empty" />
    }
    render(<EmptyModal />)
    expect(document.activeElement).toBe(screen.getByTestId('empty'))
  })
})
