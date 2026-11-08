/**
 * Controller integration: drives `attachSmartScroll` end-to-end with a fake
 * Terminal whose `.xterm-viewport` element has stubbed scroll metrics. We
 * cannot rely on jsdom's layout (scrollHeight/clientHeight are 0 without a
 * real layout engine), so the harness instruments the viewport's properties
 * to simulate growing content and user scrolls.
 *
 * E2E coverage in tests/e2e/smart-scroll.spec.ts exercises the same code
 * path against a real browser with real layout.
 */

import { describe, it, expect, vi } from 'vitest'
import { attachSmartScroll } from '@renderer/components/terminal/smartScroll'

interface FakeViewport extends HTMLElement {
  _scrollTop: number
  _scrollHeight: number
  _clientHeight: number
}

function makeFakeViewport(scrollHeight: number, clientHeight: number): FakeViewport {
  const el = document.createElement('div') as FakeViewport
  el.classList.add('xterm-viewport')
  el._scrollTop = scrollHeight - clientHeight // start at bottom
  el._scrollHeight = scrollHeight
  el._clientHeight = clientHeight
  Object.defineProperty(el, 'scrollTop', {
    get() { return el._scrollTop },
    set(v: number) { el._scrollTop = v },
    configurable: true,
  })
  Object.defineProperty(el, 'scrollHeight', {
    get() { return el._scrollHeight },
    configurable: true,
  })
  Object.defineProperty(el, 'clientHeight', {
    get() { return el._clientHeight },
    configurable: true,
  })
  return el
}

interface FakeTerm {
  element: HTMLElement
  /** Pending write callbacks queued by `term.write(data, cb)`. */
  pendingCallbacks: Array<() => void>
  /** Simulate xterm processing the write: grow scrollHeight + follow cursor. */
  growBy: (px: number) => void
  /** Resolve all pending write callbacks (parser drained). */
  flush: () => void
  scrollToBottom: ReturnType<typeof vi.fn>
  scrollLines: ReturnType<typeof vi.fn>
  write: ReturnType<typeof vi.fn>
}

function makeFakeTerm(scrollHeight = 1000, clientHeight = 200): FakeTerm {
  const root = document.createElement('div')
  const viewport = makeFakeViewport(scrollHeight, clientHeight)
  root.appendChild(viewport)

  const pendingCallbacks: Array<() => void> = []

  const term: FakeTerm = {
    element: root,
    pendingCallbacks,
    growBy(px: number) {
      viewport._scrollHeight += px
      // xterm follows the cursor: scrollTop is forced to (scrollHeight - clientHeight)
      viewport._scrollTop = viewport._scrollHeight - viewport._clientHeight
    },
    flush() {
      const cbs = pendingCallbacks.splice(0)
      for (const cb of cbs) cb()
    },
    scrollToBottom: vi.fn(() => {
      viewport._scrollTop = viewport._scrollHeight - viewport._clientHeight
    }),
    scrollLines: vi.fn(),
    write: vi.fn((_data: string, cb?: () => void) => {
      if (cb) pendingCallbacks.push(cb)
    }),
  }
  return term
}

function setUserScrollTop(term: FakeTerm, value: number) {
  const v = term.element.querySelector('.xterm-viewport') as FakeViewport
  v._scrollTop = value
}

function getScrollTop(term: FakeTerm): number {
  return (term.element.querySelector('.xterm-viewport') as FakeViewport)._scrollTop
}

describe('attachSmartScroll controller', () => {
  it('reports anchored when the viewport starts at the bottom', () => {
    const term = makeFakeTerm()
    const ctrl = attachSmartScroll(term as never, () => true)
    expect(ctrl.isAnchored()).toBe(true)
  })

  it('scrolls to bottom after a write when the user was anchored', () => {
    const term = makeFakeTerm()
    const ctrl = attachSmartScroll(term as never, () => true)

    ctrl.write('hello\r\n')
    expect(term.write).toHaveBeenCalledTimes(1)

    // Simulate xterm growing the buffer (it "auto-followed" to bottom)
    term.growBy(20)
    term.flush()

    expect(term.scrollToBottom).toHaveBeenCalled()
  })

  it('does NOT scrollToBottom when anchored but hidden — would desync the scrollbar', () => {
    const term = makeFakeTerm()
    const visible = { v: false }
    const ctrl = attachSmartScroll(term as never, () => visible.v)

    ctrl.write('hidden write\r\n')
    term.growBy(20)
    term.flush()

    expect(term.scrollToBottom).not.toHaveBeenCalled()
  })

  it('preserves the user scroll position when they had scrolled up', () => {
    // Arrange: viewport 1000 high, 200 visible. User scrolls to top (scrollTop=0).
    // Distance from bottom = 1000 - 200 - 0 = 800px.
    const term = makeFakeTerm(1000, 200)
    const ctrl = attachSmartScroll(term as never, () => true)
    setUserScrollTop(term, 0)
    expect(ctrl.isAnchored()).toBe(false)

    // Act: write streams in. Buffer grows by 300px. xterm follows cursor:
    // scrollTop is yanked to (1300 - 200) = 1100.
    ctrl.write('streamed data\r\n')
    term.growBy(300)
    term.flush()

    // Assert: the controller restored scrollTop to keep the user 800px above
    // the bottom — i.e. (1300 - 200 - 800) = 300.
    expect(getScrollTop(term)).toBe(300)
  })

  it('restores correctly across multiple sequential writes', () => {
    const term = makeFakeTerm(1000, 200)
    const ctrl = attachSmartScroll(term as never, () => true)
    setUserScrollTop(term, 0)

    for (let i = 0; i < 5; i++) {
      ctrl.write(`chunk ${i}\r\n`)
      term.growBy(100)
      term.flush()
    }

    // After 5 writes growing 100px each, scrollHeight = 1500, clientHeight = 200.
    // User was 800px from bottom; controller should keep them there: scrollTop
    // = 1500 - 200 - 800 = 500.
    expect(getScrollTop(term)).toBe(500)
  })

  it('re-engages auto-follow once the user scrolls back to the bottom', () => {
    const term = makeFakeTerm(1000, 200)
    const ctrl = attachSmartScroll(term as never, () => true)
    setUserScrollTop(term, 0)
    expect(ctrl.isAnchored()).toBe(false)

    // User scrolls back to the bottom
    setUserScrollTop(term, 800)
    expect(ctrl.isAnchored()).toBe(true)

    ctrl.write('after re-anchor\r\n')
    term.growBy(50)
    term.flush()

    expect(term.scrollToBottom).toHaveBeenCalled()
  })

  it('preserves position even while hidden', () => {
    const term = makeFakeTerm(1000, 200)
    const visible = { v: false }
    const ctrl = attachSmartScroll(term as never, () => visible.v)
    setUserScrollTop(term, 0)

    ctrl.write('hidden stream\r\n')
    term.growBy(300)
    term.flush()

    // 1300 - 200 - 800 = 300
    expect(getScrollTop(term)).toBe(300)
  })

  it('does not call setScrollTop when the new position would equal the current one (no spurious writes)', () => {
    const term = makeFakeTerm(1000, 200)
    const ctrl = attachSmartScroll(term as never, () => true)
    setUserScrollTop(term, 0)

    // Empty write — buffer doesn't grow, no auto-follow happens.
    ctrl.write('')
    term.flush()

    // scrollTop should be untouched.
    expect(getScrollTop(term)).toBe(0)
  })
})

describe('attachSmartScroll — user scrolls while writes stream in', () => {
  function viewportOf(term: FakeTerm): FakeViewport {
    return term.element.querySelector('.xterm-viewport') as FakeViewport
  }

  function userWheelTo(term: FakeTerm, scrollTop: number) {
    const v = viewportOf(term)
    v.dispatchEvent(new Event('wheel', { bubbles: true }))
    v._scrollTop = scrollTop
  }

  it('does not yank the user back to the bottom with an anchored snapshot taken before they scrolled up', () => {
    const term = makeFakeTerm(1000, 200)
    const ctrl = attachSmartScroll(term as never, () => true)

    // Snapshot is taken while anchored…
    ctrl.write('chunk\r\n')
    // …then the user scrolls up before xterm has parsed the write.
    userWheelTo(term, 0)
    term.flush()

    expect(term.scrollToBottom).not.toHaveBeenCalled()
    expect(getScrollTop(term)).toBe(0)
  })

  it('does not drag the user back up with a scrolled-up snapshot taken before they returned to the bottom', () => {
    const term = makeFakeTerm(1000, 200)
    const ctrl = attachSmartScroll(term as never, () => true)
    setUserScrollTop(term, 0)

    ctrl.write('chunk\r\n')
    userWheelTo(term, 800)
    term.flush()

    expect(getScrollTop(term)).toBe(800)
  })

  it('syncs the xterm buffer to the DOM on scroll events right after user input', () => {
    // 1000px scroll area, 200px visible → maxScrollTop 800 ↔ baseY 40.
    const term = makeFakeTerm(1000, 200)
    const buffer = { active: { baseY: 40, viewportY: 40 } }
    const scrollToLine = vi.fn((row: number) => {
      buffer.active.viewportY = row
    })
    Object.assign(term, { buffer, scrollToLine })
    attachSmartScroll(term as never, () => true)

    // xterm dropped the scroll event, so its buffer still says "bottom".
    userWheelTo(term, 200)
    viewportOf(term).dispatchEvent(new Event('scroll'))

    expect(scrollToLine).toHaveBeenCalledWith(10)
  })

  it('leaves the buffer alone on scroll events xterm causes itself', () => {
    const term = makeFakeTerm(1000, 200)
    const scrollToLine = vi.fn()
    Object.assign(term, { buffer: { active: { baseY: 40, viewportY: 40 } }, scrollToLine })
    attachSmartScroll(term as never, () => true)

    setUserScrollTop(term, 200)
    viewportOf(term).dispatchEvent(new Event('scroll'))

    expect(scrollToLine).not.toHaveBeenCalled()
  })

  it('removes its listeners on dispose', () => {
    const term = makeFakeTerm(1000, 200)
    const ctrl = attachSmartScroll(term as never, () => true)
    ctrl.dispose()

    ctrl.write('chunk\r\n')
    userWheelTo(term, 0)
    term.growBy(20)
    term.flush()

    // With the listener gone the stale anchored snapshot is acted on.
    expect(term.scrollToBottom).toHaveBeenCalled()
  })
})
