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
