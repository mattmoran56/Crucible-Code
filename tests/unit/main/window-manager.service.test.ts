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
    isVisible() { return !this.destroyed }
    isFocused() { return this.focused }
    getBounds() { return { ...this.bounds } }
    setBounds(b: any) { this.bounds = { ...b } }
    loadURL() {}
    loadFile() {}
    show() {}
    focus() {}
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

  it('moves a dropped tab between windows and closes the emptied source', () => {
    const [w1, w2] = open([
      { id: 'w1', projectIds: ['a'], activeProjectId: 'a' },
      { id: 'w2', projectIds: ['b', 'c'], activeProjectId: 'b' },
    ])
    wm.dropTab(w2.webContents, 'tok', 'a', 'w1', 1, false)
    expect(layoutSends(w2).at(-1)).toEqual({ windowId: 'w2', projectIds: ['b', 'a', 'c'], activeProjectId: 'a' })
    expect(w1.destroyed).toBe(true)
  })

  it('copies a tab with Option held, keeping it in the source', () => {
    const [w1, w2] = open([
      { id: 'w1', projectIds: ['a', 'b'], activeProjectId: 'a' },
      { id: 'w2', projectIds: ['c'], activeProjectId: 'c' },
    ])
    wm.dropTab(w2.webContents, 'tok', 'a', 'w1', 0, true)
    expect(wm.getLayoutFor(w1.webContents)?.projectIds).toEqual(['a', 'b'])
    expect(wm.getLayoutFor(w2.webContents)?.projectIds).toEqual(['a', 'c'])
  })

  it('tears a tab dropped outside every window off into a new window', async () => {
    const [w1] = open([{ id: 'w1', projectIds: ['a', 'b', 'c'], activeProjectId: 'a', bounds: { x: 0, y: 0, width: 1400, height: 900 } }])
    h.state.cursor = { x: 2200, y: 1000 }
    const done = wm.tabDragEnded(w1.webContents, 'tok', 'b', false)
    await vi.advanceTimersByTimeAsync(250)
    await done
    expect(h.state.windows).toHaveLength(2)
    const torn = h.state.windows[1]
    expect(wm.getLayoutFor(torn.webContents)?.projectIds).toEqual(['b'])
    expect(torn.opts.x).toBe(1600) // clamped so the whole window stays on screen
    expect(wm.getLayoutFor(w1.webContents)?.projectIds).toEqual(['a', 'c'])
  })

  it('does nothing when another window already took the drop', async () => {
    const [w1, w2] = open([
      { id: 'w1', projectIds: ['a', 'b'], activeProjectId: 'a', bounds: { x: 0, y: 0, width: 1000, height: 800 } },
      { id: 'w2', projectIds: ['c'], activeProjectId: 'c', bounds: { x: 1200, y: 0, width: 1000, height: 800 } },
    ])
    h.state.cursor = { x: 2500, y: 1500 }
    const done = wm.tabDragEnded(w1.webContents, 'tok', 'b', false)
    wm.dropTab(w2.webContents, 'tok', 'b', 'w1', 0, false)
    await vi.advanceTimersByTimeAsync(250)
    await done
    expect(h.state.windows).toHaveLength(2)
  })

  it('ignores a drag that ended back over its own window', async () => {
    projectIds = ['a', 'b']
    const [w1] = open([{ id: 'w1', projectIds: ['a', 'b'], activeProjectId: 'a', bounds: { x: 0, y: 0, width: 1000, height: 800 } }])
    h.state.cursor = { x: 500, y: 400 }
    const done = wm.tabDragEnded(w1.webContents, 'tok', 'b', false)
    await vi.advanceTimersByTimeAsync(250)
    await done
    expect(h.state.windows).toHaveLength(1)
    expect(wm.getLayoutFor(w1.webContents)?.projectIds).toEqual(['a', 'b'])
  })

  it('moves a tab dropped anywhere over another window into it', async () => {
    const [w1, w2] = open([
      { id: 'w1', projectIds: ['a', 'b'], activeProjectId: 'a', bounds: { x: 0, y: 0, width: 1000, height: 800 } },
      { id: 'w2', projectIds: ['c'], activeProjectId: 'c', bounds: { x: 1200, y: 0, width: 1000, height: 800 } },
    ])
    h.state.cursor = { x: 1500, y: 400 }
    const done = wm.tabDragEnded(w1.webContents, 'tok', 'b', false)
    await vi.advanceTimersByTimeAsync(250)
    await done
    expect(wm.getLayoutFor(w2.webContents)?.projectIds).toEqual(['c', 'b'])
    expect(wm.getLayoutFor(w1.webContents)?.projectIds).toEqual(['a'])
  })

  it('dragging out a window\'s only tab moves the window instead', async () => {
    projectIds = ['a']
    const [w1] = open([{ id: 'w1', projectIds: ['a'], activeProjectId: 'a', bounds: { x: 0, y: 0, width: 1000, height: 800 } }])
    h.state.cursor = { x: 2000, y: 1000 }
    const done = wm.tabDragEnded(w1.webContents, 'tok', 'a', false)
    await vi.advanceTimersByTimeAsync(250)
    await done
    expect(h.state.windows).toHaveLength(1)
    expect(w1.bounds.x).toBe(1840)
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
