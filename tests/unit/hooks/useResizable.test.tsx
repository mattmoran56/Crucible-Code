import { describe, expect, it } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useResizable } from '../../../src/renderer/hooks/useResizable'

function mouseDown(x: number, y: number) {
  return { preventDefault: () => {}, clientX: x, clientY: y } as any
}

describe('useResizable', () => {
  it('returns the initial size', () => {
    const { result } = renderHook(() => useResizable({ direction: 'horizontal', initialSize: 200 }))
    expect(result.current.size).toBe(200)
  })

  it('drags grow horizontal size by mouse delta', () => {
    const { result } = renderHook(() => useResizable({ direction: 'horizontal', initialSize: 200 }))
    act(() => result.current.onMouseDown(mouseDown(0, 0)))
    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 50, clientY: 0, bubbles: true }))
    })
    expect(result.current.size).toBe(250)
    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })
  })

  it('clamps to minSize and maxSize', () => {
    const { result } = renderHook(() =>
      useResizable({ direction: 'horizontal', initialSize: 200, minSize: 150, maxSize: 300 })
    )
    act(() => result.current.onMouseDown(mouseDown(0, 0)))
    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: -1000, clientY: 0, bubbles: true }))
    })
    expect(result.current.size).toBe(150)
    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 1000, clientY: 0, bubbles: true }))
    })
    expect(result.current.size).toBe(300)
  })

  it('inverted mode reverses the delta direction', () => {
    const { result } = renderHook(() =>
      useResizable({ direction: 'horizontal', initialSize: 200, inverted: true })
    )
    act(() => result.current.onMouseDown(mouseDown(0, 0)))
    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 30, clientY: 0, bubbles: true }))
    })
    // With inverted, +30 should shrink the panel to 170
    expect(result.current.size).toBe(170)
  })

  it('uses clientY for vertical direction', () => {
    const { result } = renderHook(() =>
      useResizable({ direction: 'vertical', initialSize: 100 })
    )
    act(() => result.current.onMouseDown(mouseDown(0, 0)))
    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 0, clientY: 40, bubbles: true }))
    })
    expect(result.current.size).toBe(140)
  })

  it('does not move when no mousedown occurred', () => {
    const { result } = renderHook(() => useResizable({ direction: 'horizontal', initialSize: 200 }))
    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 0, bubbles: true }))
    })
    expect(result.current.size).toBe(200)
  })
})
