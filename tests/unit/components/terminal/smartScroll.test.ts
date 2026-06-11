import { describe, it, expect } from 'vitest'
import {
  ANCHOR_THRESHOLD,
  DOM_ANCHOR_TOLERANCE_PX,
  computeDomScrollAction,
  computeScrollAction,
  distanceFromBottom,
  isAnchoredToBottom,
  isDomAnchored,
  linesFromBottom,
} from '@renderer/components/terminal/smartScroll'

describe('isAnchoredToBottom', () => {
  it('is true when the viewport sits exactly at the bottom', () => {
    expect(isAnchoredToBottom({ viewportY: 100, baseY: 100 })).toBe(true)
  })

  it('is true within the default threshold of the bottom', () => {
    expect(isAnchoredToBottom({ viewportY: 100 - ANCHOR_THRESHOLD, baseY: 100 })).toBe(true)
  })

  it('is false beyond the default threshold', () => {
    expect(isAnchoredToBottom({ viewportY: 100 - ANCHOR_THRESHOLD - 1, baseY: 100 })).toBe(false)
  })

  it('respects a custom threshold', () => {
    expect(isAnchoredToBottom({ viewportY: 90, baseY: 100 }, 10)).toBe(true)
    expect(isAnchoredToBottom({ viewportY: 89, baseY: 100 }, 10)).toBe(false)
  })

  it('treats viewportY past baseY as anchored (defensive)', () => {
    expect(isAnchoredToBottom({ viewportY: 105, baseY: 100 })).toBe(true)
  })
})

describe('linesFromBottom', () => {
  it('is 0 when viewport is at the bottom', () => {
    expect(linesFromBottom({ viewportY: 100, baseY: 100 })).toBe(0)
  })

  it('measures distance up from the bottom', () => {
    expect(linesFromBottom({ viewportY: 70, baseY: 100 })).toBe(30)
  })

  it('clamps at 0 when viewport overshoots baseY', () => {
    expect(linesFromBottom({ viewportY: 110, baseY: 100 })).toBe(0)
  })
})

describe('computeScrollAction', () => {
  describe('user was anchored to the bottom', () => {
    it('scrolls to bottom while visible', () => {
      expect(
        computeScrollAction({
          wasAnchored: true,
          savedLinesFromBottom: 0,
          buf: { viewportY: 150, baseY: 150 },
          visible: true,
        }),
      ).toEqual({ type: 'scrollToBottom' })
    })

    it('does nothing while hidden — scrollToBottom on a hidden xterm desyncs the scrollbar', () => {
      expect(
        computeScrollAction({
          wasAnchored: true,
          savedLinesFromBottom: 0,
          buf: { viewportY: 150, baseY: 150 },
          visible: false,
        }),
      ).toEqual({ type: 'none' })
    })
  })

  describe('user had scrolled up', () => {
    it('restores the offset after xterm followed the cursor to the bottom', () => {
      // Before the write the user was viewing 30 lines above the bottom
      // (baseY=100, viewportY=70). The pty pushed 50 lines, so baseY is now
      // 150 and xterm has yanked the viewport to viewportY=150 to follow the
      // cursor. We want the user back at viewportY=120 (still 30 lines above
      // bottom), i.e. delta = -30.
      const action = computeScrollAction({
        wasAnchored: false,
        savedLinesFromBottom: 30,
        buf: { viewportY: 150, baseY: 150 },
        visible: true,
      })
      expect(action).toEqual({ type: 'scrollLines', delta: -30 })
    })

    it('returns none when the viewport already sits at the saved offset', () => {
      // xterm did not auto-scroll (e.g. write contained no cursor advance).
      expect(
        computeScrollAction({
          wasAnchored: false,
          savedLinesFromBottom: 30,
          buf: { viewportY: 120, baseY: 150 },
          visible: true,
        }),
      ).toEqual({ type: 'none' })
    })

    it('clamps the target so we never scroll above row 0', () => {
      expect(
        computeScrollAction({
          wasAnchored: false,
          savedLinesFromBottom: 999,
          buf: { viewportY: 50, baseY: 100 },
          visible: true,
        }),
      ).toEqual({ type: 'scrollLines', delta: -50 })
    })

    it('still restores while hidden — the user position must survive a tab switch', () => {
      expect(
        computeScrollAction({
          wasAnchored: false,
          savedLinesFromBottom: 30,
          buf: { viewportY: 150, baseY: 150 },
          visible: false,
        }),
      ).toEqual({ type: 'scrollLines', delta: -30 })
    })

    it('emits a positive delta when xterm under-scrolled past the saved offset', () => {
      // Hypothetical: viewportY ended up above the saved target, push it down.
      const action = computeScrollAction({
        wasAnchored: false,
        savedLinesFromBottom: 10,
        buf: { viewportY: 100, baseY: 150 },
        visible: true,
      })
      // target = 150 - 10 = 140, current = 100, delta = +40
      expect(action).toEqual({ type: 'scrollLines', delta: 40 })
    })
  })
})

describe('isDomAnchored', () => {
  it('is true when scrollTop sits at the bottom', () => {
    expect(isDomAnchored({ scrollTop: 800, clientHeight: 200, scrollHeight: 1000 })).toBe(true)
  })

  it('is true within the default tolerance of the bottom', () => {
    expect(
      isDomAnchored({ scrollTop: 800 - DOM_ANCHOR_TOLERANCE_PX, clientHeight: 200, scrollHeight: 1000 }),
    ).toBe(true)
  })

  it('is false past the tolerance', () => {
    expect(
      isDomAnchored({ scrollTop: 800 - DOM_ANCHOR_TOLERANCE_PX - 1, clientHeight: 200, scrollHeight: 1000 }),
    ).toBe(false)
  })

  it('is true when there is nothing to scroll', () => {
    expect(isDomAnchored({ scrollTop: 0, clientHeight: 200, scrollHeight: 200 })).toBe(true)
  })
})

describe('distanceFromBottom', () => {
  it('is 0 at the bottom', () => {
    expect(distanceFromBottom({ scrollTop: 800, clientHeight: 200, scrollHeight: 1000 })).toBe(0)
  })

  it('measures pixels above the bottom', () => {
    expect(distanceFromBottom({ scrollTop: 0, clientHeight: 200, scrollHeight: 1000 })).toBe(800)
  })

  it('clamps at 0 if scrollTop overshoots (defensive)', () => {
    expect(distanceFromBottom({ scrollTop: 9999, clientHeight: 200, scrollHeight: 1000 })).toBe(0)
  })
})

describe('computeDomScrollAction', () => {
  it('scrolls to bottom when the user was anchored and we are visible', () => {
    expect(
      computeDomScrollAction({
        wasAnchored: true,
        savedDistanceFromBottom: 0,
        state: { scrollTop: 800, scrollHeight: 1200, clientHeight: 200 },
        visible: true,
      }),
    ).toEqual({ type: 'scrollToBottom' })
  })

  it('does nothing when anchored but hidden', () => {
    expect(
      computeDomScrollAction({
        wasAnchored: true,
        savedDistanceFromBottom: 0,
        state: { scrollTop: 800, scrollHeight: 1200, clientHeight: 200 },
        visible: false,
      }),
    ).toEqual({ type: 'none' })
  })

  it('restores the user position after the buffer grew', () => {
    // User had 200px above bottom. After write, scrollHeight grew from 1000
    // to 1200 and xterm yanked scrollTop to (1200 - 200) = 1000. Restore to
    // (1200 - 200 - 200) = 800 to keep them at the same content.
    expect(
      computeDomScrollAction({
        wasAnchored: false,
        savedDistanceFromBottom: 200,
        state: { scrollTop: 1000, scrollHeight: 1200, clientHeight: 200 },
        visible: true,
      }),
    ).toEqual({ type: 'setScrollTop', scrollTop: 800 })
  })

  it('still restores while hidden — user position must persist across tab switches', () => {
    expect(
      computeDomScrollAction({
        wasAnchored: false,
        savedDistanceFromBottom: 200,
        state: { scrollTop: 1000, scrollHeight: 1200, clientHeight: 200 },
        visible: false,
      }),
    ).toEqual({ type: 'setScrollTop', scrollTop: 800 })
  })

  it('returns none when already at the saved offset', () => {
    expect(
      computeDomScrollAction({
        wasAnchored: false,
        savedDistanceFromBottom: 200,
        state: { scrollTop: 800, scrollHeight: 1200, clientHeight: 200 },
        visible: true,
      }),
    ).toEqual({ type: 'none' })
  })

  it('clamps the target so it never goes below 0', () => {
    expect(
      computeDomScrollAction({
        wasAnchored: false,
        savedDistanceFromBottom: 9999,
        state: { scrollTop: 50, scrollHeight: 500, clientHeight: 200 },
        visible: true,
      }),
    ).toEqual({ type: 'setScrollTop', scrollTop: 0 })
  })
})

describe('exported constants', () => {
  it('ANCHOR_THRESHOLD is 3 lines', () => {
    expect(ANCHOR_THRESHOLD).toBe(3)
  })

  it('DOM_ANCHOR_TOLERANCE_PX is 8 pixels', () => {
    expect(DOM_ANCHOR_TOLERANCE_PX).toBe(8)
  })
})

describe('isAnchoredToBottom — threshold edges', () => {
  it('threshold 0 requires exact bottom', () => {
    expect(isAnchoredToBottom({ viewportY: 100, baseY: 100 }, 0)).toBe(true)
    expect(isAnchoredToBottom({ viewportY: 99, baseY: 100 }, 0)).toBe(false)
  })

  it('handles baseY 0 (empty buffer) as anchored', () => {
    expect(isAnchoredToBottom({ viewportY: 0, baseY: 0 })).toBe(true)
  })
})

describe('computeScrollAction — anchored branch ignores buffer state', () => {
  it('returns scrollToBottom regardless of an absurd saved offset', () => {
    expect(
      computeScrollAction({
        wasAnchored: true,
        savedLinesFromBottom: 99999,
        buf: { viewportY: 0, baseY: 0 },
        visible: true,
      }),
    ).toEqual({ type: 'scrollToBottom' })
  })

  it('savedLinesFromBottom 0 with unmoved viewport yields none', () => {
    expect(
      computeScrollAction({
        wasAnchored: false,
        savedLinesFromBottom: 0,
        buf: { viewportY: 150, baseY: 150 },
        visible: true,
      }),
    ).toEqual({ type: 'none' })
  })
})

describe('isDomAnchored / distanceFromBottom — sub-pixel and zero-tolerance', () => {
  it('tolerance 0 requires the exact bottom', () => {
    expect(isDomAnchored({ scrollTop: 800, clientHeight: 200, scrollHeight: 1000 }, 0)).toBe(true)
    expect(isDomAnchored({ scrollTop: 799.5, clientHeight: 200, scrollHeight: 1000 }, 0)).toBe(false)
  })

  it('distanceFromBottom preserves fractional pixels', () => {
    expect(distanceFromBottom({ scrollTop: 799.25, clientHeight: 200, scrollHeight: 1000 })).toBe(0.75)
  })
})

describe('computeDomScrollAction — sub-pixel no-op window', () => {
  it('treats a difference below 1px as already-there', () => {
    expect(
      computeDomScrollAction({
        wasAnchored: false,
        savedDistanceFromBottom: 200,
        state: { scrollTop: 799.5, scrollHeight: 1200, clientHeight: 200 },
        visible: true,
      }),
    ).toEqual({ type: 'none' })
  })

  it('a full 1px difference still triggers a restore', () => {
    expect(
      computeDomScrollAction({
        wasAnchored: false,
        savedDistanceFromBottom: 200,
        state: { scrollTop: 799, scrollHeight: 1200, clientHeight: 200 },
        visible: true,
      }),
    ).toEqual({ type: 'setScrollTop', scrollTop: 800 })
  })

  it('clamped target of 0 with scrollTop already 0 is a no-op', () => {
    expect(
      computeDomScrollAction({
        wasAnchored: false,
        savedDistanceFromBottom: 9999,
        state: { scrollTop: 0, scrollHeight: 500, clientHeight: 200 },
        visible: true,
      }),
    ).toEqual({ type: 'none' })
  })

  it('anchored branch ignores the saved distance entirely', () => {
    expect(
      computeDomScrollAction({
        wasAnchored: true,
        savedDistanceFromBottom: 12345,
        state: { scrollTop: 0, scrollHeight: 100, clientHeight: 100 },
        visible: false,
      }),
    ).toEqual({ type: 'none' })
  })
})

interface FakeViewportState {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

function makeFakeTerm(initial: FakeViewportState | null) {
  const state: FakeViewportState | null = initial ? { ...initial } : null
  let element: HTMLElement | undefined
  if (state) {
    element = document.createElement('div')
    const viewport = document.createElement('div')
    viewport.className = 'xterm-viewport'
    Object.defineProperty(viewport, 'scrollTop', {
      configurable: true,
      get: () => state.scrollTop,
      set: (v: number) => {
        state.scrollTop = v
      },
    })
    Object.defineProperty(viewport, 'scrollHeight', { configurable: true, get: () => state.scrollHeight })
    Object.defineProperty(viewport, 'clientHeight', { configurable: true, get: () => state.clientHeight })
    element.appendChild(viewport)
  }

  const writes: string[] = []
  let scrollToBottomCalls = 0
  let onWrite: (() => void) | null = null

  const term = {
    element,
    write: (data: string, cb?: () => void) => {
      writes.push(data)
      onWrite?.()
      cb?.()
    },
    scrollToBottom: () => {
      scrollToBottomCalls += 1
      if (state) state.scrollTop = state.scrollHeight - state.clientHeight
    },
  } as unknown as Terminal

  return {
    term,
    state,
    writes,
    getScrollToBottomCalls: () => scrollToBottomCalls,
    setOnWrite: (fn: () => void) => {
      onWrite = fn
    },
  }
}

describe('attachSmartScroll — controller against a fake terminal', () => {
  it('isAnchored() defaults to true when the terminal has no element yet', () => {
    const { term } = makeFakeTerm(null)
    const ctl = attachSmartScroll(term, () => true)
    expect(ctl.isAnchored()).toBe(true)
  })

  it('isAnchored() reads the live DOM state', () => {
    const fake = makeFakeTerm({ scrollTop: 800, scrollHeight: 1000, clientHeight: 200 })
    const ctl = attachSmartScroll(fake.term, () => true)
    expect(ctl.isAnchored()).toBe(true)

    fake.state!.scrollTop = 100
    expect(ctl.isAnchored()).toBe(false)
  })

  it('write() while anchored and visible follows the bottom after growth', () => {
    const fake = makeFakeTerm({ scrollTop: 800, scrollHeight: 1000, clientHeight: 200 })
    const ctl = attachSmartScroll(fake.term, () => true)
    fake.setOnWrite(() => {
      fake.state!.scrollHeight = 1500 // pty pushed more lines
    })

    ctl.write('new output')

    expect(fake.writes).toEqual(['new output'])
    expect(fake.getScrollToBottomCalls()).toBe(1)
    // The controller force-syncs the DOM scrollbar to scrollHeight.
    expect(fake.state!.scrollTop).toBe(1500)
  })

  it('write() while anchored but hidden leaves the scrollbar alone', () => {
    const fake = makeFakeTerm({ scrollTop: 800, scrollHeight: 1000, clientHeight: 200 })
    const ctl = attachSmartScroll(fake.term, () => false)
    fake.setOnWrite(() => {
      fake.state!.scrollHeight = 1500
    })

    ctl.write('new output')

    expect(fake.getScrollToBottomCalls()).toBe(0)
    expect(fake.state!.scrollTop).toBe(800)
  })

  it('write() while scrolled up restores the reading position after a yank', () => {
    // 700px above the bottom before the write.
    const fake = makeFakeTerm({ scrollTop: 100, scrollHeight: 1000, clientHeight: 200 })
    const ctl = attachSmartScroll(fake.term, () => true)
    fake.setOnWrite(() => {
      fake.state!.scrollHeight = 1400
      fake.state!.scrollTop = 1200 // xterm followed the cursor to the bottom
    })

    ctl.write('stream')

    expect(fake.getScrollToBottomCalls()).toBe(0)
    // target = 1400 - 200 - 700 = 500
    expect(fake.state!.scrollTop).toBe(500)
  })

  it('write() while scrolled up restores even when hidden', () => {
    const fake = makeFakeTerm({ scrollTop: 100, scrollHeight: 1000, clientHeight: 200 })
    const ctl = attachSmartScroll(fake.term, () => false)
    fake.setOnWrite(() => {
      fake.state!.scrollHeight = 1400
      fake.state!.scrollTop = 1200
    })

    ctl.write('stream')

    expect(fake.state!.scrollTop).toBe(500)
  })

  it('write() that does not move the viewport is a no-op for the scrollbar', () => {
    const fake = makeFakeTerm({ scrollTop: 100, scrollHeight: 1000, clientHeight: 200 })
    const ctl = attachSmartScroll(fake.term, () => true)

    ctl.write('[2K') // pure control sequence, no geometry change

    expect(fake.getScrollToBottomCalls()).toBe(0)
    expect(fake.state!.scrollTop).toBe(100)
  })

  it('write() without a DOM element still forwards data and does not crash', () => {
    const fake = makeFakeTerm(null)
    const ctl = attachSmartScroll(fake.term, () => true)

    expect(() => ctl.write('early data')).not.toThrow()
    expect(fake.writes).toEqual(['early data'])
    expect(fake.getScrollToBottomCalls()).toBe(0)
  })

  it('sequential anchored writes keep following the growing buffer', () => {
    const fake = makeFakeTerm({ scrollTop: 800, scrollHeight: 1000, clientHeight: 200 })
    const ctl = attachSmartScroll(fake.term, () => true)

    fake.setOnWrite(() => {
      fake.state!.scrollHeight += 100
    })
    ctl.write('a')
    ctl.write('b')
    ctl.write('c')

    expect(fake.getScrollToBottomCalls()).toBe(3)
    expect(fake.state!.scrollTop).toBe(1300)
    expect(fake.writes).toEqual(['a', 'b', 'c'])
  })

  it('dispose() is safe to call and write keeps working afterwards', () => {
    const fake = makeFakeTerm({ scrollTop: 800, scrollHeight: 1000, clientHeight: 200 })
    const ctl = attachSmartScroll(fake.term, () => true)

    expect(() => ctl.dispose()).not.toThrow()
    ctl.write('after dispose')
    expect(fake.writes).toEqual(['after dispose'])
  })
})

import { attachSmartScroll } from '@renderer/components/terminal/smartScroll'
import type { Terminal } from '@xterm/xterm'
