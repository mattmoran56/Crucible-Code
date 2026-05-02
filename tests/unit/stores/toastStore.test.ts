import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useToastStore } from '../../../src/renderer/stores/toastStore'

describe('toastStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useToastStore.setState({ toasts: [] })
  })

  afterEach(() => {
    vi.useRealTimers()
    useToastStore.setState({ toasts: [] })
  })

  it('appends a toast with unique id and the right type/message', () => {
    useToastStore.getState().addToast('error', 'Boom')
    useToastStore.getState().addToast('success', 'Saved')
    const { toasts } = useToastStore.getState()
    expect(toasts).toHaveLength(2)
    expect(toasts[0]).toMatchObject({ type: 'error', message: 'Boom' })
    expect(toasts[1]).toMatchObject({ type: 'success', message: 'Saved' })
    expect(toasts[0].id).not.toBe(toasts[1].id)
    expect(toasts[0].id.length).toBeGreaterThan(0)
  })

  it('auto-dismisses a toast after 5 seconds', () => {
    useToastStore.getState().addToast('info', 'Hello')
    expect(useToastStore.getState().toasts).toHaveLength(1)
    vi.advanceTimersByTime(4_999)
    expect(useToastStore.getState().toasts).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('auto-dismiss only removes the matching id when others are added', () => {
    useToastStore.getState().addToast('info', 'first')
    vi.advanceTimersByTime(2_000)
    useToastStore.getState().addToast('info', 'second')
    vi.advanceTimersByTime(3_000)
    // first one should now be gone, second one still alive
    const messages = useToastStore.getState().toasts.map((t) => t.message)
    expect(messages).toEqual(['second'])
  })

  it('removeToast removes the matching id and leaves others', () => {
    useToastStore.getState().addToast('info', 'a')
    useToastStore.getState().addToast('info', 'b')
    const [first] = useToastStore.getState().toasts
    useToastStore.getState().removeToast(first.id)
    const messages = useToastStore.getState().toasts.map((t) => t.message)
    expect(messages).toEqual(['b'])
  })
})
