import { describe, expect, it } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMultiPanelResize } from '../../../src/renderer/hooks/useMultiPanelResize'

// IMPORTANT: this hook expects stable array references for `minSizes` and
// `collapsedPanels` — the recalc effect depends on them, so passing a fresh
// array literal on every render triggers an infinite render loop. We extract
// each fixture once and pass the same reference back through.

describe('useMultiPanelResize', () => {
  const minSizes = [50, 50, 50]
  const initialRatios = [1, 1, 1]
  const collapsedNone = [false, false, false]

  it('initialises every panel to a non-zero size that respects minimums', () => {
    const { result } = renderHook(() =>
      useMultiPanelResize({
        containerSize: 600,
        minSizes,
        initialRatios,
        collapsedPanels: collapsedNone,
        collapsedSize: 32,
      })
    )
    expect(result.current.sizes).toHaveLength(3)
    for (const s of result.current.sizes) expect(s).toBeGreaterThanOrEqual(50)
  })

  it('returns zeros when containerSize is 0', () => {
    const minSizes2 = [50, 50]
    const initialRatios2 = [1, 1]
    const collapsedPanels2 = [false, false]
    const { result } = renderHook(() =>
      useMultiPanelResize({
        containerSize: 0,
        minSizes: minSizes2,
        initialRatios: initialRatios2,
        collapsedPanels: collapsedPanels2,
        collapsedSize: 32,
      })
    )
    expect(result.current.sizes).toEqual([0, 0])
  })

  it('drags between two panels redistribute size while respecting minimums', () => {
    const { result } = renderHook(() =>
      useMultiPanelResize({
        containerSize: 600,
        minSizes,
        initialRatios,
        collapsedPanels: collapsedNone,
        collapsedSize: 32,
      })
    )
    const before = [...result.current.sizes]
    act(() => {
      result.current.onHandleMouseDown(0)({ preventDefault: () => {}, clientY: 100 } as any)
      document.dispatchEvent(new MouseEvent('mousemove', { clientY: 150, bubbles: true }))
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })
    expect(result.current.sizes[0]).toBeGreaterThan(before[0])
    expect(result.current.sizes[1]).toBeLessThan(before[1])
    expect(result.current.sizes[2]).toBeCloseTo(before[2], 0)
  })

  it('collapsing a panel pins it at collapsedSize', () => {
    const collapsedMid = [false, true, false]
    const { result } = renderHook(({ panels }) =>
      useMultiPanelResize({
        containerSize: 600,
        minSizes,
        initialRatios,
        collapsedPanels: panels,
        collapsedSize: 32,
      }),
      { initialProps: { panels: collapsedMid } }
    )
    expect(result.current.sizes[1]).toBe(32)
    expect(result.current.sizes[0] + result.current.sizes[2]).toBeGreaterThan(32)
  })
})
