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

describe('toastStore edge cases', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useToastStore.setState({ toasts: [] })
  })

  afterEach(() => {
    vi.useRealTimers()
    useToastStore.setState({ toasts: [] })
  })

  it('supports all three toast types', () => {
    useToastStore.getState().addToast('error', 'e')
    useToastStore.getState().addToast('success', 's')
    useToastStore.getState().addToast('info', 'i')
    expect(useToastStore.getState().toasts.map((t) => t.type)).toEqual([
      'error',
      'success',
      'info',
    ])
  })

  it('removeToast with an unknown id leaves the list unchanged', () => {
    useToastStore.getState().addToast('info', 'stay')
    useToastStore.getState().removeToast('not-a-real-id')
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual(['stay'])
  })

  it('removeToast on an empty store is a harmless no-op', () => {
    useToastStore.getState().removeToast('anything')
    expect(useToastStore.getState().toasts).toEqual([])
  })

  it('a manually removed toast does not break later auto-dismissal of others', () => {
    useToastStore.getState().addToast('info', 'first')
    vi.advanceTimersByTime(1_000)
    useToastStore.getState().addToast('info', 'second')
    const [first] = useToastStore.getState().toasts
    useToastStore.getState().removeToast(first.id)
    // first's timer fires at t=5s; second should survive until t=6s
    vi.advanceTimersByTime(4_000)
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual(['second'])
    vi.advanceTimersByTime(1_000)
    expect(useToastStore.getState().toasts).toEqual([])
  })

  it('staggered toasts expire individually in creation order', () => {
    useToastStore.getState().addToast('info', 'a')
    vi.advanceTimersByTime(2_000)
    useToastStore.getState().addToast('info', 'b')
    vi.advanceTimersByTime(2_000)
    useToastStore.getState().addToast('info', 'c')
    vi.advanceTimersByTime(1_000) // t=5s: a expires
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual(['b', 'c'])
    vi.advanceTimersByTime(2_000) // t=7s: b expires
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual(['c'])
    vi.advanceTimersByTime(2_000) // t=9s: c expires
    expect(useToastStore.getState().toasts).toEqual([])
  })

  it('toasts added in the same tick all dismiss together after 5 seconds', () => {
    useToastStore.getState().addToast('info', 'x')
    useToastStore.getState().addToast('info', 'y')
    useToastStore.getState().addToast('info', 'z')
    vi.advanceTimersByTime(5_000)
    expect(useToastStore.getState().toasts).toEqual([])
  })

  it('generates unique ids across many rapid toasts', () => {
    for (let i = 0; i < 20; i++) {
      useToastStore.getState().addToast('info', `msg-${i}`)
    }
    const ids = useToastStore.getState().toasts.map((t) => t.id)
    expect(new Set(ids).size).toBe(20)
  })

  it('preserves insertion order of pending toasts', () => {
    useToastStore.getState().addToast('error', 'one')
    useToastStore.getState().addToast('success', 'two')
    useToastStore.getState().addToast('info', 'three')
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual([
      'one',
      'two',
      'three',
    ])
  })
})
