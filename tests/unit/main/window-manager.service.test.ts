import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ── Electron mocks ──────────────────────────────────────────────────────────
const h = vi.hoisted(() => {
  const state = {
    cursor: { x: 0, y: 0 },
    saved: [] as unknown[],
    windows: [] as any[],
  }
  let nextId = 1
  class FakeWindow {
    id = nextId++
    opts: any
    handlers: Record<string, Array<(...a: any[]) => void>> = {}
    destroyed = false
    minimized = false
    focused = false
    bounds: { x: number; y: number; width: number; height: number }
    webContents: any
    constructor(opts: any) {
      this.opts = opts
      this.bounds = { x: opts.x ?? 0, y: opts.y ?? 0, width: opts.width, height: opts.height }
      this.webContents = { id: this.id, send: vi.fn(), once: vi.fn() }
      state.windows.push(this)
    }
    on(ev: string, fn: (...a: any[]) => void) {
      ;(this.handlers[ev] ??= []).push(fn)
      return this
    }
    once(ev: string, fn: (...a: any[]) => void) {
      return this.on(ev, fn)
    }
    emit(ev: string) {
      for (const fn of this.handlers[ev] ?? []) fn()
    }
    isDestroyed() { return this.destroyed }
    isMinimized() { return this.minimized }
    isFullScreen() { return false }
    visible = true
    opacity = 1
    isVisible() { return !this.destroyed && this.visible }
    isFocused() { return this.focused }
    getBounds() { return { ...this.bounds } }
    // hiddenInset title bar: the content fills the window.
    getContentBounds() { return { ...this.bounds } }
    setBounds(b: any) { this.bounds = { ...b } }
    setPosition(x: number, y: number) { this.bounds = { ...this.bounds, x, y } }
    setOpacity(o: number) { this.opacity = o }
    loadURL() {}
    loadFile() {}
    show() { this.visible = true }
    showInactive() { this.visible = true }
    hide() { this.visible = false }
    focus() { this.focused = true }
    restore() { this.minimized = false }
    close() {
      this.emit('close')
      this.destroyed = true
      this.emit('closed')
    }
    /** What a renderer's window.close() does: no 'close' event, only 'closed'. */
    closeFromRenderer() {
      this.destroyed = true
      this.emit('closed')
    }
  }
  return { state, FakeWindow }
})

vi.mock('electron', () => ({
  app: { on: vi.fn(), getPath: () => '/tmp', isPackaged: false },
  BrowserWindow: h.FakeWindow,
  screen: {
    getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 3000, height: 2000 } }],
    getCursorScreenPoint: () => h.state.cursor,
    getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 3000, height: 2000 } }),
  },
}))

vi.mock('electron-store', () => ({
  default: class {
    get(_k: string, d: unknown) { return h.state.saved.length ? h.state.saved : d }
    set(_k: string, v: unknown[]) { h.state.saved = v }
  },
}))

vi.mock('../../../src/main/store-path', () => ({ getStorePath: () => '/tmp' }))
vi.mock('../../../src/main/services/claude-web.service', () => ({ installClaudeWebGuards: vi.fn() }))

import * as wm from '../../../src/main/services/window-manager.service'
import { IPC } from '../../../src/shared/constants'

let projectIds: string[] = []

function open(saved: unknown[]) {
  h.state.saved = saved
  wm.openInitialWindows(() => projectIds)
  return h.state.windows
}

const layoutSends = (w: any) =>
  w.webContents.send.mock.calls.filter((c: any[]) => c[0] === IPC.WINDOW_LAYOUT_CHANGED).map((c: any[]) => c[1])

beforeEach(() => {
  vi.useFakeTimers()
  wm.__resetForTests()
  h.state.windows.length = 0
  h.state.saved = []
  h.state.cursor = { x: 0, y: 0 }
  projectIds = ['a', 'b', 'c']
})

afterEach(() => {
  vi.useRealTimers()
})

describe('window manager', () => {
  it('opens one window with every project the first time', () => {
    const [w] = open([])
    expect(h.state.windows).toHaveLength(1)
    expect(wm.getLayoutFor(w.webContents)).toMatchObject({ projectIds: ['a', 'b', 'c'], activeProjectId: 'a' })
  })

  it('restores saved windows, each with its own tabs', () => {
    const [w1, w2] = open([
      { id: 'w1', projectIds: ['a', 'b'], activeProjectId: 'b', bounds: { x: 10, y: 20, width: 1000, height: 700 } },
      { id: 'w2', projectIds: ['c', 'a'], activeProjectId: 'c' },
    ])
    expect(h.state.windows).toHaveLength(2)
    expect(w1.opts).toMatchObject({ x: 10, y: 20, width: 1000, height: 700 })
    expect(wm.getLayoutFor(w1.webContents)).toEqual({ windowId: 'w1', projectIds: ['a', 'b'], activeProjectId: 'b' })
    expect(wm.getLayoutFor(w2.webContents)).toEqual({ windowId: 'w2', projectIds: ['c', 'a'], activeProjectId: 'c' })
  })

  it('broadcasts events to every window but sends run-once events to one', () => {
    const [w1, w2] = open([
      { id: 'w1', projectIds: ['a'], activeProjectId: 'a' },
      { id: 'w2', projectIds: ['b', 'c'], activeProjectId: 'b' },
    ])
    wm.appWindows.webContents.send(IPC.TERMINAL_DATA, 'term-1', 'hi')
    expect(w1.webContents.send).toHaveBeenCalledWith(IPC.TERMINAL_DATA, 'term-1', 'hi')
    expect(w2.webContents.send).toHaveBeenCalledWith(IPC.TERMINAL_DATA, 'term-1', 'hi')

    wm.appWindows.webContents.send(IPC.SCHEDULER_FIRE_QUEUED_SESSION, { id: 'q' })
    expect(w1.webContents.send).toHaveBeenCalledWith(IPC.SCHEDULER_FIRE_QUEUED_SESSION, { id: 'q' })
    expect(w2.webContents.send).not.toHaveBeenCalledWith(IPC.SCHEDULER_FIRE_QUEUED_SESSION, expect.anything())
  })

  it('closing a window hands its projects to another window, never dropping them', () => {
    const [w1, w2] = open([
      { id: 'w1', projectIds: ['a', 'b'], activeProjectId: 'a' },
      { id: 'w2', projectIds: ['c', 'a'], activeProjectId: 'c' },
    ])
    w1.close()
    expect(layoutSends(w2).at(-1)).toEqual({ windowId: 'w2', projectIds: ['c', 'a', 'b'], activeProjectId: 'c' })
  })

  it('also hands projects over when the renderer closes its window (only "closed" fires)', () => {
    const [w1, w2] = open([
      { id: 'w1', projectIds: ['a', 'b'], activeProjectId: 'a' },
      { id: 'w2', projectIds: ['c'], activeProjectId: 'c' },
    ])
    w1.closeFromRenderer()
    expect(wm.getLayoutFor(w2.webContents)?.projectIds).toEqual(['c', 'a', 'b'])
    expect((h.state.saved as any[]).map((w) => w.id)).toEqual(['w2'])
  })

  it('keeps the last window\'s layout when it closes', () => {
    const [w1] = open([{ id: 'w1', projectIds: ['a', 'b', 'c'], activeProjectId: 'b' }])
    w1.close()
    expect(h.state.saved).toEqual([{ id: 'w1', projectIds: ['a', 'b', 'c'], activeProjectId: 'b', bounds: expect.anything() }])
  })

  it('keeps every window\'s layout when the app quits', () => {
    const [w1, w2] = open([
      { id: 'w1', projectIds: ['a'], activeProjectId: 'a' },
      { id: 'w2', projectIds: ['b', 'c'], activeProjectId: 'b' },
    ])
    wm.markQuitting()
    w1.close()
    w2.close()
    expect((h.state.saved as any[]).map((w) => w.projectIds)).toEqual([['a'], ['b', 'c']])
  })

  it('will not close a tab that no other window shows', () => {
    const [w1] = open([
      { id: 'w1', projectIds: ['a', 'b'], activeProjectId: 'a' },
      { id: 'w2', projectIds: ['c', 'a'], activeProjectId: 'c' },
    ])
    // 'a' is open in w2 too, so it can close; 'b' is only here, so it stays.
    const out = wm.setLayoutFor(w1.webContents, [], null)
    expect(out?.projectIds).toEqual(['b'])
  })

  it('opens a project in a new window as a move or a copy', () => {
    projectIds = ['a', 'b']
    const [w1] = open([{ id: 'w1', projectIds: ['a', 'b'], activeProjectId: 'a' }])
    wm.openProjectInNewWindow(w1.webContents, 'a', 'copy')
    expect(wm.getLayoutFor(w1.webContents)?.projectIds).toEqual(['a', 'b'])
    wm.openProjectInNewWindow(w1.webContents, 'b', 'move')
    expect(wm.getLayoutFor(w1.webContents)?.projectIds).toEqual(['a'])
    expect(h.state.windows).toHaveLength(3)
    expect(wm.getLayoutFor(h.state.windows[2].webContents)?.projectIds).toEqual(['b'])
  })

  it('adds new projects to the window that added them and removes deleted ones everywhere', () => {
    const [w1, w2] = open([
      { id: 'w1', projectIds: ['a'], activeProjectId: 'a' },
      { id: 'w2', projectIds: ['b', 'c'], activeProjectId: 'b' },
    ])
    projectIds = ['a', 'b', 'c', 'd']
    wm.projectAdded(w2.webContents, 'd')
    expect(wm.getLayoutFor(w2.webContents)).toMatchObject({ projectIds: ['b', 'c', 'd'], activeProjectId: 'd' })
    projectIds = ['b', 'c', 'd']
    wm.projectRemoved('a')
    // w1 is now empty, so it closes.
    expect(w1.destroyed).toBe(true)
  })

  it('brings forward the window showing a notification\'s project', () => {
    const [, w2] = open([
      { id: 'w1', projectIds: ['a'], activeProjectId: 'a' },
      { id: 'w2', projectIds: ['b', 'c'], activeProjectId: 'b' },
    ])
    expect(wm.focusWindowForProject('c')).toBe(w2)
  })
})

describe('dragging a project tab', () => {
  // Default strip geometry: tabs start 78px in, 176px wide, 177px apart; strip is 44px tall.
  const W1 = { x: 0, y: 0, width: 1400, height: 900 }
  const W2 = { x: 1500, y: 0, width: 1000, height: 800 }
  const grab = { x: 10, y: 10 }

  /** Move the cursor and let the drag poll see it. */
  const moveTo = (x: number, y: number) => {
    h.state.cursor = { x, y }
    vi.advanceTimersByTime(20)
  }
  const tabs = (w: any) => wm.getLayoutFor(w.webContents)?.projectIds

  it('reorders live within the strip', () => {
    const [w1] = open([{ id: 'w1', projectIds: ['a', 'b', 'c'], activeProjectId: 'b', bounds: W1 }])
    wm.startTabDrag(w1.webContents, 'a', grab)
    expect(wm.getLayoutFor(w1.webContents)?.activeProjectId).toBe('a')
    moveTo(78 + 10 + 177, 20)
    expect(tabs(w1)).toEqual(['b', 'a', 'c'])
    moveTo(78 + 10 + 177 * 2, 50) // a little below the strip still counts
    expect(tabs(w1)).toEqual(['b', 'c', 'a'])
    wm.endTabDrag(w1.webContents, {})
    expect(wm.isTabDragActive()).toBe(false)
    expect(h.state.windows).toHaveLength(1)
    expect(layoutSends(w1).at(-1)).toEqual({ windowId: 'w1', projectIds: ['b', 'c', 'a'], activeProjectId: 'a' })
  })

  it('tears the tab off into a new window that follows the cursor, removing it from the source', () => {
    const [w1] = open([{ id: 'w1', projectIds: ['a', 'b', 'c'], activeProjectId: 'a', bounds: W1 }])
    wm.startTabDrag(w1.webContents, 'b', grab)
    moveTo(700, 300)
    expect(h.state.windows).toHaveLength(2)
    const torn = h.state.windows[1]
    expect(tabs(torn)).toEqual(['b'])
    expect(tabs(w1)).toEqual(['a', 'c'])
    expect(torn.visible).toBe(true)
    expect(torn.focused).toBe(false) // shown without stealing the mouse from the source
    expect(torn.bounds).toMatchObject({ x: 700 - 78 - 10, y: 300 - 10, width: 1400, height: 900 })
    moveTo(900, 400)
    expect(torn.bounds).toMatchObject({ x: 900 - 78 - 10, y: 400 - 10 })

    // Released over nothing: it stays where it was dropped.
    wm.endTabDrag(w1.webContents, {})
    vi.advanceTimersByTime(500)
    expect(torn.destroyed).toBe(false)
    expect(torn.focused).toBe(true)
    expect(torn.bounds).toMatchObject({ x: 812, y: 390 })
    expect((h.state.saved as any[]).map((w) => w.projectIds)).toEqual([['a', 'c'], ['b']])
  })

  it('attaches to another window\'s strip, hiding the torn-off window and destroying it on release', () => {
    const [w1, w2] = open([
      { id: 'w1', projectIds: ['a', 'b'], activeProjectId: 'a', bounds: W1 },
      { id: 'w2', projectIds: ['c'], activeProjectId: 'c', bounds: W2 },
    ])
    wm.startTabDrag(w1.webContents, 'b', grab)
    moveTo(700, 300)
    const torn = h.state.windows[2]
    expect(tabs(torn)).toEqual(['b'])

    moveTo(1500 + 78 + 10 + 177, 20) // over w2's strip, after its tab
    expect(tabs(w2)).toEqual(['c', 'b'])
    expect(tabs(torn)).toEqual([])
    expect(torn.visible).toBe(false)
    expect(tabs(w1)).toEqual(['a'])

    // Dragging back out reuses the torn-off window.
    moveTo(800, 500)
    expect(h.state.windows).toHaveLength(3)
    expect(tabs(torn)).toEqual(['b'])
    expect(torn.visible).toBe(true)
    expect(tabs(w2)).toEqual(['c'])

    moveTo(1500 + 20, 20) // back into w2, first slot
    expect(tabs(w2)).toEqual(['b', 'c'])
    wm.endTabDrag(w1.webContents, {})
    expect(torn.destroyed).toBe(true)
    expect(wm.getLayoutFor(w2.webContents)).toEqual({ windowId: 'w2', projectIds: ['b', 'c'], activeProjectId: 'b' })
    expect(w2.focused).toBe(true)
    expect(tabs(w1)).toEqual(['a'])
  })

  it('moves a tab straight from one strip to another', () => {
    const [w1, w2] = open([
      { id: 'w1', projectIds: ['a', 'b'], activeProjectId: 'a', bounds: W1 },
      { id: 'w2', projectIds: ['c'], activeProjectId: 'c', bounds: W2 },
    ])
    wm.startTabDrag(w1.webContents, 'a', grab)
    moveTo(1500 + 20, 20)
    expect(h.state.windows).toHaveLength(2)
    expect(tabs(w2)).toEqual(['a', 'c'])
    expect(tabs(w1)).toEqual(['b'])
    wm.endTabDrag(w1.webContents, {})
    expect(tabs(w1)).toEqual(['b'])
    expect(w1.destroyed).toBe(false)
  })

  it('dragging a window\'s only tab out moves the window itself', () => {
    projectIds = ['a', 'b']
    const [w1, w2] = open([
      { id: 'w1', projectIds: ['a'], activeProjectId: 'a', bounds: W1 },
      { id: 'w2', projectIds: ['b'], activeProjectId: 'b', bounds: W2 },
    ])
    wm.startTabDrag(w1.webContents, 'a', grab)
    moveTo(700, 300)
    expect(h.state.windows).toHaveLength(2)
    expect(w1.bounds).toMatchObject({ x: 700 - 78 - 10, y: 290 })
    expect(tabs(w1)).toEqual(['a'])
    wm.endTabDrag(w1.webContents, {})
    expect(w1.destroyed).toBe(false)
    expect(tabs(w2)).toEqual(['b'])
  })

  it('closes the source on release when its only tab moved to another window', () => {
    projectIds = ['a', 'b']
    const [w1, w2] = open([
      { id: 'w1', projectIds: ['a'], activeProjectId: 'a', bounds: W1 },
      { id: 'w2', projectIds: ['b'], activeProjectId: 'b', bounds: W2 },
    ])
    wm.startTabDrag(w1.webContents, 'a', grab)
    moveTo(700, 300) // the source follows the cursor...
    moveTo(1500 + 78 + 10 + 177, 20) // ...then the tab joins w2
    expect(tabs(w2)).toEqual(['b', 'a'])
    // The source must stay open (it still owns the mouse) but is invisible.
    expect(w1.destroyed).toBe(false)
    expect(w1.opacity).toBe(0)

    // Back out: the source window comes back and follows again.
    moveTo(600, 400)
    expect(tabs(w1)).toEqual(['a'])
    expect(w1.opacity).toBe(1)
    expect(h.state.windows).toHaveLength(2)

    moveTo(1500 + 20, 20)
    wm.endTabDrag(w1.webContents, {})
    expect(w1.destroyed).toBe(true)
    expect(tabs(w2)).toEqual(['a', 'b'])
  })

  it('Escape restores the layout from before the drag', () => {
    const [w1, w2] = open([
      { id: 'w1', projectIds: ['a', 'b'], activeProjectId: 'a', bounds: W1 },
      { id: 'w2', projectIds: ['c'], activeProjectId: 'c', bounds: W2 },
    ])
    wm.startTabDrag(w1.webContents, 'b', grab)
    moveTo(700, 300)
    const torn = h.state.windows[2]
    moveTo(1500 + 20, 20)
    wm.endTabDrag(w1.webContents, { cancel: true })
    expect(torn.destroyed).toBe(true)
    expect(wm.getLayoutFor(w1.webContents)).toEqual({ windowId: 'w1', projectIds: ['a', 'b'], activeProjectId: 'a' })
    expect(wm.getLayoutFor(w2.webContents)).toEqual({ windowId: 'w2', projectIds: ['c'], activeProjectId: 'c' })
    expect(layoutSends(w2).at(-1)?.projectIds).toEqual(['c'])
  })

  it('Escape puts a moved only-tab window back', () => {
    projectIds = ['a']
    const [w1] = open([{ id: 'w1', projectIds: ['a'], activeProjectId: 'a', bounds: W1 }])
    wm.startTabDrag(w1.webContents, 'a', grab)
    moveTo(700, 300)
    wm.endTabDrag(w1.webContents, { cancel: true })
    expect(w1.bounds).toEqual(W1)
  })

  it('Option at release copies the tab, keeping it in the source too', () => {
    const [w1, w2] = open([
      { id: 'w1', projectIds: ['a', 'b'], activeProjectId: 'a', bounds: W1 },
      { id: 'w2', projectIds: ['c'], activeProjectId: 'c', bounds: W2 },
    ])
    wm.startTabDrag(w1.webContents, 'b', grab)
    moveTo(1500 + 78 + 10 + 177, 20)
    wm.endTabDrag(w1.webContents, { copy: true })
    expect(tabs(w1)).toEqual(['a', 'b'])
    expect(tabs(w2)).toEqual(['c', 'b'])
  })

  it('only the window that started the drag can end it', () => {
    const [w1, w2] = open([
      { id: 'w1', projectIds: ['a', 'b'], activeProjectId: 'a', bounds: W1 },
      { id: 'w2', projectIds: ['c'], activeProjectId: 'c', bounds: W2 },
    ])
    wm.startTabDrag(w1.webContents, 'b', grab)
    wm.endTabDrag(w2.webContents, {})
    expect(wm.isTabDragActive()).toBe(true)
    wm.endTabDrag(w1.webContents, {})
    expect(wm.isTabDragActive()).toBe(false)
  })

  it('hit-tests with the strip geometry each window reports', () => {
    const [w1] = open([{ id: 'w1', projectIds: ['a', 'b', 'c'], activeProjectId: 'a', bounds: W1 }])
    wm.reportTabStrip(w1.webContents, { left: 100, top: 0, height: 44, tabWidth: 100, slot: 100 })
    wm.startTabDrag(w1.webContents, 'a', grab)
    moveTo(100 + 10 + 200, 20)
    expect(tabs(w1)).toEqual(['b', 'c', 'a'])
    wm.endTabDrag(w1.webContents, {})
  })
})
