/**
 * Smart scroll: keep the viewport stuck to the bottom while the agent streams
 * output, but let the user scroll up to read past content without being yanked
 * back. xterm's default is to follow the cursor on writes, which is what
 * yanks them back — we counter that by snapshotting the user's distance from
 * the bottom before each write and restoring it after the parser finishes.
 */

import type { Terminal } from '@xterm/xterm'

export interface BufferState {
  /** Buffer line index of the top of the viewport. */
  viewportY: number
  /** Buffer line index of the top of the bottom-most page (i.e. fully scrolled down). */
  baseY: number
}

/** Lines of slack near the bottom that still count as "anchored". */
export const ANCHOR_THRESHOLD = 3

export function isAnchoredToBottom(buf: BufferState, threshold = ANCHOR_THRESHOLD): boolean {
  return buf.viewportY >= buf.baseY - threshold
}

export function linesFromBottom(buf: BufferState): number {
  return Math.max(0, buf.baseY - buf.viewportY)
}

export type ScrollAction =
  | { type: 'none' }
  | { type: 'scrollToBottom' }
  | { type: 'scrollLines'; delta: number }

export function computeScrollAction(args: {
  wasAnchored: boolean
  savedLinesFromBottom: number
  buf: BufferState
  visible: boolean
}): ScrollAction {
  const { wasAnchored, savedLinesFromBottom, buf, visible } = args

  if (wasAnchored) {
    return visible ? { type: 'scrollToBottom' } : { type: 'none' }
  }

  const targetY = Math.max(0, buf.baseY - savedLinesFromBottom)
  const delta = targetY - buf.viewportY
  return delta === 0 ? { type: 'none' } : { type: 'scrollLines', delta }
}

/** Pixel slack near the bottom that still counts as "anchored" in DOM space. */
export const DOM_ANCHOR_TOLERANCE_PX = 8

export interface DomScrollState {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

export function isDomAnchored(s: DomScrollState, tolerance = DOM_ANCHOR_TOLERANCE_PX): boolean {
  return s.scrollTop + s.clientHeight >= s.scrollHeight - tolerance
}

export function distanceFromBottom(s: DomScrollState): number {
  return Math.max(0, s.scrollHeight - s.clientHeight - s.scrollTop)
}

export type DomScrollAction =
  | { type: 'none' }
  | { type: 'scrollToBottom' }
  | { type: 'setScrollTop'; scrollTop: number }

/**
 * Decide what to do with the DOM viewport after a write completes. Pure so we
 * can unit-test exhaustively without a real Terminal.
 */
export function computeDomScrollAction(args: {
  wasAnchored: boolean
  savedDistanceFromBottom: number
  state: DomScrollState
  visible: boolean
}): DomScrollAction {
  const { wasAnchored, savedDistanceFromBottom, state, visible } = args

  if (wasAnchored) {
    return visible ? { type: 'scrollToBottom' } : { type: 'none' }
  }

  const target = Math.max(0, state.scrollHeight - state.clientHeight - savedDistanceFromBottom)
  // No-op if we are already there (avoid spurious scroll events).
  if (Math.abs(state.scrollTop - target) < 1) return { type: 'none' }
  return { type: 'setScrollTop', scrollTop: target }
}

export interface SmartScrollController {
  /** Write `data` to the terminal, preserving the user's scroll position. */
  write: (data: string) => void
  /** True when the viewport is anchored to the bottom. */
  isAnchored: () => boolean
  /** Tear down listeners. */
  dispose: () => void
}

/**
 * Attach smart-scroll behaviour to an xterm Terminal.
 *
 * Detection is done against the live DOM scroll position of `.xterm-viewport`
 * — that is the only source of truth that updates synchronously with user
 * input (wheel, scrollbar drag, touch, keyboard). xterm's `onScroll` event is
 * driven off the *buffer*'s viewportY which is updated asynchronously from
 * the DOM scroll, so we cannot rely on it during a stream of writes.
 */
export function attachSmartScroll(
  term: Terminal,
  getVisible: () => boolean,
): SmartScrollController {
  function getViewport(): HTMLElement | null {
    return term.element?.querySelector<HTMLElement>('.xterm-viewport') ?? null
  }

  function readState(): DomScrollState | null {
    const v = getViewport()
    if (!v) return null
    return { scrollTop: v.scrollTop, scrollHeight: v.scrollHeight, clientHeight: v.clientHeight }
  }

  function isAnchored(): boolean {
    const s = readState()
    return s ? isDomAnchored(s) : true
  }

  // --- User scroll tracking -------------------------------------------------
  //
  // Two races between the user's scroll and a stream of writes:
  //
  // 1. Stale snapshots. xterm parses writes asynchronously, so a write's
  //    "before" snapshot can predate a scroll the user made while it was
  //    queued; acting on it would undo that scroll (e.g. yank them back to
  //    the bottom). We count user scroll input and skip the correction for
  //    any write snapshotted before the latest input.
  //
  // 2. Dropped scroll events. xterm (5.x) applies a wheel/scrollbar scroll to
  //    the DOM first and moves its buffer viewport on the next `scroll` event.
  //    When xterm repaints it also writes scrollTop itself and flags the next
  //    scroll event as its own; if the user's scroll lands in the same frame
  //    the browser coalesces both into one event, xterm ignores it, its buffer
  //    stays at the bottom, and the following repaint snaps the DOM back.
  //    While the user is scrolling we sync the buffer from the DOM on every
  //    scroll event so a dropped one can't lose their position.
  const USER_SCROLL_WINDOW_MS = 250
  let userScrollSeq = 0
  let userScrollUntil = 0
  let pointerHeld = false
  const root = term.element
  const viewportEl = getViewport()

  const onUserScrollInput = () => {
    userScrollSeq++
    userScrollUntil = performance.now() + USER_SCROLL_WINDOW_MS
  }
  const onPointerDown = () => {
    pointerHeld = true
    onUserScrollInput()
  }
  const onPointerUp = () => {
    if (!pointerHeld) return
    pointerHeld = false
    onUserScrollInput()
  }
  const onViewportScroll = () => {
    if (!pointerHeld && performance.now() > userScrollUntil) return
    const v = getViewport()
    const buf = term.buffer?.active
    if (!v || !buf || buf.baseY <= 0) return
    // xterm sizes the scroll area so that the maximum scrollTop maps exactly
    // onto baseY, so the DOM position converts to a buffer row linearly.
    const maxScrollTop = v.scrollHeight - v.clientHeight
    if (maxScrollTop <= 0) return
    const row = Math.round((v.scrollTop / maxScrollTop) * buf.baseY)
    if (row !== buf.viewportY) term.scrollToLine(row)
  }

  const inputEvents = ['wheel', 'touchmove'] as const
  for (const ev of inputEvents) {
    root?.addEventListener(ev, onUserScrollInput, { capture: true, passive: true })
  }
  root?.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true })
  window.addEventListener('pointerup', onPointerUp, { capture: true, passive: true })
  window.addEventListener('pointercancel', onPointerUp, { capture: true, passive: true })
  viewportEl?.addEventListener('scroll', onViewportScroll, { passive: true })

  function write(data: string): void {
    const stateBefore = readState()
    const wasAnchored = stateBefore ? isDomAnchored(stateBefore) : true
    const savedDistanceFromBottom = stateBefore ? distanceFromBottom(stateBefore) : 0
    const seqAtSnapshot = userScrollSeq

    term.write(data, () => {
      // The user scrolled after this snapshot: their latest position wins,
      // and the next write takes a fresh snapshot.
      if (userScrollSeq !== seqAtSnapshot) return

      const v = getViewport()
      const stateAfter = readState()
      if (!v || !stateAfter) return

      const action = computeDomScrollAction({
        wasAnchored,
        savedDistanceFromBottom,
        state: stateAfter,
        visible: getVisible(),
      })
      if (action.type === 'scrollToBottom') {
        term.scrollToBottom()
        // term.scrollToBottom updates the buffer; force the DOM scrollbar to
        // match in case xterm hasn't repainted yet.
        v.scrollTop = stateAfter.scrollHeight
      } else if (action.type === 'setScrollTop') {
        v.scrollTop = action.scrollTop
      }
    })
  }

  return {
    write,
    isAnchored,
    dispose: () => {
      for (const ev of inputEvents) {
        root?.removeEventListener(ev, onUserScrollInput, { capture: true })
      }
      root?.removeEventListener('pointerdown', onPointerDown, { capture: true })
      window.removeEventListener('pointerup', onPointerUp, { capture: true })
      window.removeEventListener('pointercancel', onPointerUp, { capture: true })
      viewportEl?.removeEventListener('scroll', onViewportScroll)
    },
  }
}
