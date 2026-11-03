/**
 * Pure geometry for dragging project tabs, Chrome-style.
 *
 * Shared by the main process (which runs a drag across windows: hit-testing
 * every window's tab strip against the cursor, tearing the tab off into a
 * window that follows the cursor) and the renderer (which reorders tabs
 * locally when there is no window manager, e.g. the mock app).
 *
 * All coordinates are DIPs. Strip geometry is in a window's content (client)
 * coordinates; cursor and window bounds are in screen coordinates.
 */

export interface Point {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Where a window's project tabs sit, in its content coordinates. */
export interface TabStripGeometry {
  /** Left edge of the first tab slot. */
  left: number
  /** Top of the tab strip. */
  top: number
  /** Height of the tab strip. */
  height: number
  /** Width of one tab. */
  tabWidth: number
  /** Distance from one tab's left edge to the next's (width + gap). */
  slot: number
}

/** The strip as ProjectTabs lays it out: 78px for the traffic lights, `w-44` tabs, `gap-px`, `h-11`. */
export const DEFAULT_TAB_STRIP: TabStripGeometry = { left: 78, top: 0, height: 44, tabWidth: 176, slot: 177 }

/** Pointer travel (px) before a press on a tab becomes a drag. */
export const DRAG_START_DISTANCE = 4

/**
 * How far the cursor may stray outside the strip of the window holding the
 * tab before it tears off. Entering another window's strip has no margin.
 */
export const DETACH_MARGIN = { x: 24, y: 36 }

/**
 * Slot (0..count) a dragged tab drops into, given where its left edge is.
 * `count` is the number of OTHER tabs in the strip. Picks the nearest slot,
 * so the tab swaps with a neighbour once it is over half of it.
 */
export function insertionIndex(tabLeft: number, count: number, strip: TabStripGeometry): number {
  const slot = strip.slot > 0 ? strip.slot : DEFAULT_TAB_STRIP.slot
  const i = Math.round((tabLeft - strip.left) / slot)
  return Math.max(0, Math.min(count, i))
}

/** Move `id` to `index` (in the list without it). Returns a new array. */
export function placeAt<T>(ids: T[], id: T, index: number): T[] {
  const rest = ids.filter((x) => x !== id)
  const at = Math.max(0, Math.min(index, rest.length))
  return [...rest.slice(0, at), id, ...rest.slice(at)]
}

/** A window the dragged tab could land in. */
export interface DragWindow {
  id: string
  /** Content bounds on screen. */
  bounds: Rect
  strip: TabStripGeometry
  /** Tabs it shows, not counting the dragged one. */
  tabCount: number
}

export interface DropTarget {
  windowId: string
  index: number
}

/** A window's tab strip on screen, grown by `margin` on every side. */
export function stripRect(w: Pick<DragWindow, 'bounds' | 'strip'>, margin: Point = { x: 0, y: 0 }): Rect {
  return {
    x: w.bounds.x - margin.x,
    y: w.bounds.y + w.strip.top - margin.y,
    width: w.bounds.width + margin.x * 2,
    height: w.strip.height + margin.y * 2,
  }
}

function inside(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height
}

/**
 * Which window's tab strip the cursor is over, and at which slot.
 *
 * `attachedId` is the window currently holding the tab (null while it is torn
 * off): the tab stays there until the cursor leaves its strip by
 * `margin`. Otherwise the first window (front-most first) whose strip the
 * cursor is inside wins. Null means "torn off".
 *
 * `grabX` is how far into the tab the pointer grabbed it.
 */
export function findDropTarget(
  cursor: Point,
  grabX: number,
  windows: DragWindow[],
  attachedId: string | null,
  margin: Point = DETACH_MARGIN
): DropTarget | null {
  const at = (w: DragWindow): DropTarget => ({
    windowId: w.id,
    index: insertionIndex(cursor.x - w.bounds.x - grabX, w.tabCount, w.strip),
  })
  const attached = attachedId ? windows.find((w) => w.id === attachedId) : undefined
  if (attached && inside(stripRect(attached, margin), cursor)) return at(attached)
  const over = windows.find((w) => w.id !== attachedId && inside(stripRect(w), cursor))
  return over ? at(over) : null
}

/**
 * Top-left for a torn-off window holding just the dragged tab (its first
 * tab), so the pointer stays on the same spot of the tab it grabbed.
 */
export function detachedWindowPosition(cursor: Point, grab: Point, strip: TabStripGeometry): Point {
  return { x: Math.round(cursor.x - strip.left - grab.x), y: Math.round(cursor.y - strip.top - grab.y) }
}
