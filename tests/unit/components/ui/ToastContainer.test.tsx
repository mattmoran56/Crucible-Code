import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastContainer } from '../../../../src/renderer/components/ui/ToastContainer'
import { useToastStore } from '../../../../src/renderer/stores/toastStore'

beforeEach(() => {
  vi.useFakeTimers()
  useToastStore.setState({ toasts: [] })
})

afterEach(() => {
  vi.useRealTimers()
  useToastStore.setState({ toasts: [] })
})

describe('ToastContainer', () => {
  it('renders nothing when there are no toasts', () => {
    const { container } = render(<ToastContainer />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders one element per toast with the message', () => {
    useToastStore.getState().addToast('error', 'Something broke')
    useToastStore.getState().addToast('success', 'Saved')
    render(<ToastContainer />)
    expect(screen.getByText('Something broke')).toBeInTheDocument()
    expect(screen.getByText('Saved')).toBeInTheDocument()
  })

  it('clicking the dismiss button removes the toast', () => {
    useToastStore.getState().addToast('info', 'hello')
    const { rerender } = render(<ToastContainer />)
    const id = useToastStore.getState().toasts[0].id
    useToastStore.getState().removeToast(id)
    rerender(<ToastContainer />)
    expect(screen.queryByText('hello')).not.toBeInTheDocument()
  })

  it('uses different colour classes per toast type', () => {
    useToastStore.getState().addToast('error', 'bad')
    useToastStore.getState().addToast('success', 'good')
    useToastStore.getState().addToast('info', 'fyi')
    render(<ToastContainer />)
    expect(screen.getByText('bad').parentElement!.className).toMatch(/bg-danger/)
    expect(screen.getByText('good').parentElement!.className).toMatch(/bg-success/)
    expect(screen.getByText('fyi').parentElement!.className).toMatch(/bg-accent/)
  })
})
