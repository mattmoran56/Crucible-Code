import { app, BrowserWindow, screen, type WebContents } from 'electron'
import { join } from 'path'
import { randomUUID } from 'node:crypto'
import Store from 'electron-store'
import { IPC } from '../../shared/constants'
import type { WindowLayout, WindowSummary } from '../../shared/types'
import { getStorePath } from '../store-path'
import { eventBus } from './event-bus'
import { installClaudeWebGuards } from './claude-web.service'
import {
  addProjectToWindow,
  closeWindow,
  moveProject,
  reconcileLayouts,
  removeProjectEverywhere,
  removeProjectFromWindow,
  setWindowTabs,
  type LayoutEntry,
  type WindowBounds,
} from './window-layout'
import {
  DEFAULT_TAB_STRIP,
  detachedWindowPosition,
  findDropTarget,
  type DragWindow,
  type Point,
  type TabStripGeometry,
} from '../../shared/tab-drag'

/**
 * Owns every app window and which project tabs each one shows.
 *
 * The rest of the main process was written for a single window: IPC handlers
 * and services hold a `BrowserWindow` and call `webContents.send` on it. Rather
 * than thread a window through all of them, they get `appWindows` — a stand-in
 * that broadcasts to every open window. Each renderer filters events down to
 * the terminals, agents and sessions it is showing, exactly as it did before.
 *
 * A few events trigger one-shot work in the renderer (a scheduled session
 * firing, a Notion task being picked up). Those go to one window only, so the
 * work is not done once per window.
 */

const DEFAULT_SIZE = { width: 1400, height: 900 }

/** Channels whose renderer handler does work that must happen exactly once. */
const PRIMARY_ONLY_CHANNELS = new Set<string>([
  IPC.SCHEDULER_FIRE_QUEUED_SESSION,
  IPC.SCHEDULER_FIRE_QUEUED_MESSAGE,
  IPC.NOTION_FIRE_TASK,
])

interface WindowRecord {
  id: string
  win: BrowserWindow
  focusedAt: number
}

const records = new Map<string, WindowRecord>()
let layouts: LayoutEntry[] = []
let quitting = false
let projectIdsSource: () => string[] = () => []
/** The tab drag in progress, if any (see "Tab dragging" below). */
let drag: DragSession | null = null
/** Each window's tab-strip geometry, as its renderer last reported it. */
const strips = new Map<string, TabStripGeometry>()

let store: Store<{ windows: LayoutEntry[] }> | null = null
function layoutStore(): Store<{ windows: LayoutEntry[] }> {
  if (!store) {
    store = new Store<{ windows: LayoutEntry[] }>({
      name: 'window-layout',
      cwd: getStorePath(),
      defaults: { windows: [] },
    })
  }
  return store
}

let persistTimer: ReturnType<typeof setTimeout> | null = null
function persistSoon(): void {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(persistNow, 300)
}
function persistNow(): void {
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  try {
    layoutStore().set('windows', layouts)
  } catch (err) {
    console.warn('[windows] failed to save window layout:', err)
  }
}

function liveRecords(): WindowRecord[] {
  return [...records.values()].filter((r) => !r.win.isDestroyed())
}

/** The longest-open window: it handles the run-once events. */
function primaryRecord(): WindowRecord | undefined {
  return liveRecords()[0]
}

function lastFocusedRecord(exceptId?: string): WindowRecord | undefined {
  const candidates = liveRecords().filter((r) => r.id !== exceptId)
  const focused = candidates.find((r) => r.win.isFocused())
  if (focused) return focused
  return candidates.sort((a, b) => b.focusedAt - a.focusedAt)[0]
}

function recordForSender(sender: WebContents | undefined | null): WindowRecord | undefined {
  if (!sender) return undefined
  for (const r of records.values()) {
    if (!r.win.isDestroyed() && r.win.webContents === sender) return r
  }
  return undefined
}

function layoutOf(windowId: string): WindowLayout | null {
  const entry = layouts.find((w) => w.id === windowId)
  if (!entry) return null
  return { windowId: entry.id, projectIds: [...entry.projectIds], activeProjectId: entry.activeProjectId }
}

function sendLayout(windowId: string): void {
  const rec = records.get(windowId)
  const layout = layoutOf(windowId)
  if (!rec || rec.win.isDestroyed() || !layout) return
  rec.win.webContents.send(IPC.WINDOW_LAYOUT_CHANGED, layout)
}

function focusRecord(rec: WindowRecord): void {
  if (rec.win.isDestroyed()) return
  if (rec.win.isMinimized()) rec.win.restore()
  rec.win.show()
  rec.win.focus()
}

/** Close windows that no longer have any tabs (only while another window remains). */
function closeEmptyWindows(): void {
  // Mid-drag a window may be empty only for now (the tab can come back).
  if (drag) return
  for (const entry of layouts) {
    if (entry.projectIds.length > 0) continue
    if (liveRecords().length <= 1) return
    const rec = records.get(entry.id)
    if (rec && !rec.win.isDestroyed()) rec.win.close()
  }
}

/** Size and (when still on a connected display) position for a window's saved bounds. */
function placement(bounds: WindowBounds | undefined): { width: number; height: number; x?: number; y?: number } {
  if (!bounds) return { ...DEFAULT_SIZE }
  const visible = screen.getAllDisplays().some((d) => {
    const a = d.workArea
    return bounds.x < a.x + a.width && bounds.x + bounds.width > a.x && bounds.y < a.y + a.height && bounds.y + bounds.height > a.y
  })
  return visible ? { ...bounds } : { width: bounds.width, height: bounds.height }
}

/**
 * `showInactive`: show straight away without taking focus — for the window
 * a dragged tab tears off into, which must appear under the cursor at once
 * and must not take the mouse away from the window running the drag.
 */
function createAppWindow(entry: LayoutEntry, opts: { showInactive?: boolean } = {}): WindowRecord {
  const win = new BrowserWindow({
    ...placement(entry.bounds),
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#faf6f1',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // For the embedded claude.ai/code page in cloud sessions' Agent tab.
      // Every webview is hardened (and restricted to claude.ai on its own
      // partition) by installClaudeWebGuards below.
      webviewTag: true,
    },
  })
  installClaudeWebGuards(win.webContents)

  const rec: WindowRecord = { id: entry.id, win, focusedAt: Date.now() }
  records.set(entry.id, rec)

  if (opts.showInactive) win.showInactive()
  else win.once('ready-to-show', () => win.show())
  win.on('focus', () => {
    rec.focusedAt = Date.now()
  })

  const saveBounds = () => {
    if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return
    const b = win.getBounds()
    layouts = layouts.map((w) => (w.id === rec.id ? { ...w, bounds: b } : w))
    persistSoon()
  }
  win.on('moved', saveBounds)
  win.on('resized', saveBounds)

  // Quitting, or closing the last window: keep the layout so it comes back
  // next launch. Otherwise its tabs that no other window shows move to the
  // window used most recently — closing a window never removes a project.
  let gone = false
  const windowGone = () => {
    if (gone) return
    gone = true
    const into = lastFocusedRecord(rec.id)
    if (!quitting && into) {
      layouts = closeWindow(layouts, rec.id, into.id)
      sendLayout(into.id)
    }
    persistNow()
  }
  win.on('close', () => {
    saveBounds()
    windowGone()
  })
  // A renderer-initiated close (window.close()) skips 'close' and only emits 'closed'.
  win.on('closed', () => {
    records.delete(rec.id)
    windowGone()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return rec
}

/**
 * Stand-in `BrowserWindow` handed to IPC handlers and services that predate
 * multiple windows. `webContents.send` reaches every window (and the relay's
 * event bus, once); focus calls go to the window used last.
 */
export const appWindows = {
  webContents: {
    send(channel: string, ...args: unknown[]): void {
      if (PRIMARY_ONLY_CHANNELS.has(channel)) {
        primaryRecord()?.win.webContents.send(channel, ...args)
      } else {
        for (const r of liveRecords()) r.win.webContents.send(channel, ...args)
      }
      // Dual-emit onto the in-process bus so the embedded relay server can fan
      // the same events out to paired remote receivers.
      eventBus.emit(channel, ...args)
    },
  },
  isDestroyed: (): boolean => false,
  isMinimized: (): boolean => {
    const live = liveRecords()
    return live.length > 0 && live.every((r) => r.win.isMinimized())
  },
  isVisible: (): boolean => liveRecords().some((r) => r.win.isVisible()),
  isFocused: (): boolean => liveRecords().some((r) => r.win.isFocused()),
  restore: (): void => lastFocusedRecord()?.win.restore(),
  show: (): void => lastFocusedRecord()?.win.show(),
  focus: (): void => lastFocusedRecord()?.win.focus(),
} as unknown as BrowserWindow

/** Real window for a renderer request (e.g. to parent a dialog), if any. */
export function browserWindowFor(sender: WebContents | undefined | null): BrowserWindow | undefined {
  return recordForSender(sender)?.win ?? lastFocusedRecord()?.win
}

/** Send to every window except the one that made the request. */
export function notifyOtherWindows(sender: WebContents | undefined | null, channel: string, ...args: unknown[]): void {
  for (const r of liveRecords()) {
    if (sender && r.win.webContents === sender) continue
    r.win.webContents.send(channel, ...args)
  }
}

/**
 * Open the windows saved last time (or one window with every project).
 * `projectIds` reads the current project list.
 */
export function openInitialWindows(projectIds: () => string[]): void {
  projectIdsSource = projectIds
  let saved: LayoutEntry[] = []
  try {
    saved = layoutStore().get('windows', [])
  } catch {
    saved = []
  }
  layouts = reconcileLayouts(Array.isArray(saved) ? saved : [], projectIds(), randomUUID)
  persistNow()
  for (const entry of layouts) createAppWindow(entry)
}

/** macOS dock click with no windows open. */
export function reopenWindows(): void {
  if (liveRecords().length > 0) return
  openInitialWindows(projectIdsSource)
}

export function markQuitting(): void {
  quitting = true
  persistNow()
}

function openNewWindow(projectIds: string[], bounds?: WindowBounds, opts: { showInactive?: boolean } = {}): WindowRecord {
  const entry: LayoutEntry = {
    id: randomUUID(),
    projectIds,
    activeProjectId: projectIds[0] ?? null,
    bounds,
  }
  layouts = [...layouts, entry]
  persistSoon()
  return createAppWindow(entry, opts)
}

/** Bounds for a new window opened from a menu: cascaded off the source window. */
function cascadeFrom(rec: WindowRecord | undefined): WindowBounds | undefined {
  if (!rec || rec.win.isDestroyed()) return undefined
  const b = rec.win.getBounds()
  return { x: b.x + 32, y: b.y + 32, width: b.width, height: b.height }
}

// ── IPC operations ─────────────────────────────────────────────────────────

export function getLayoutFor(sender: WebContents | undefined): WindowLayout | null {
  const rec = recordForSender(sender)
  return rec ? layoutOf(rec.id) : null
}

export function setLayoutFor(
  sender: WebContents | undefined,
  projectIds: string[],
  activeProjectId: string | null
): WindowLayout | null {
  const rec = recordForSender(sender)
  if (!rec) return null
  const known = new Set(projectIdsSource())
  const before = layouts.find((w) => w.id === rec.id)?.projectIds ?? []
  const wanted = projectIds.filter((id) => known.has(id))
  // Closing a tab is only allowed while another window still shows the
  // project; otherwise it stays (removing a project is its own action).
  const elsewhere = new Set(layouts.filter((w) => w.id !== rec.id).flatMap((w) => w.projectIds))
  const kept = before.filter((id) => !wanted.includes(id) && !elsewhere.has(id) && known.has(id))
  layouts = setWindowTabs(layouts, rec.id, [...wanted, ...kept], activeProjectId)
  persistSoon()
  if (kept.length > 0) sendLayout(rec.id)
  return layoutOf(rec.id)
}

export function listWindows(sender: WebContents | undefined): WindowSummary[] {
  const self = recordForSender(sender)
  return liveRecords()
    .map((r) => layoutOf(r.id))
    .filter((l): l is WindowLayout => !!l)
    .map((l) => ({ ...l, isCurrent: l.windowId === self?.id }))
}

/** Apply a cross-window move, tell both windows, close the source if emptied. */
function applyMove(projectId: string, fromId: string, toId: string): void {
  layouts = moveProject(layouts, projectId, fromId, toId)
  persistSoon()
  sendLayout(toId)
  if (fromId !== toId) sendLayout(fromId)
  const target = records.get(toId)
  if (target) focusRecord(target)
  closeEmptyWindows()
}

/** "Move to window" from the tab context menu. */
export function sendTab(sender: WebContents | undefined, projectId: string, toWindowId: string): void {
  const source = recordForSender(sender)
  if (!source || !records.has(toWindowId) || source.id === toWindowId) return
  applyMove(projectId, source.id, toWindowId)
}

/** Open a project in a new window, moving it out of the sender's window or keeping a copy there. */
export function openProjectInNewWindow(
  sender: WebContents | undefined,
  projectId: string,
  mode: 'move' | 'copy'
): void {
  const source = recordForSender(sender)
  openNewWindow([projectId], cascadeFrom(source))
  if (source && mode === 'move') {
    layouts = removeProjectFromWindow(layouts, source.id, projectId)
    persistSoon()
    sendLayout(source.id)
    closeEmptyWindows()
  }
}

// ── Tab dragging ───────────────────────────────────────────────────────────
//
// Chrome-style: the renderer that saw the press calls startTabDrag and holds
// pointer capture until release, then calls endTabDrag. In between, main owns
// the drag. It polls the cursor (the source renderer may no longer show the
// tab, so it cannot report positions over other windows) and moves the tab:
//   - within the strip of the window holding it: live reorder;
//   - out of that strip by DETACH_MARGIN: torn off into a new window that
//     follows the cursor (or, for a window's only tab, the window itself);
//   - into another window's strip: attached there at the slot under the
//     cursor (the torn-off window hides until the tab leaves again).
// Every step is a move, so the tab is only ever in one place. Escape restores
// the layout from before the drag.
//
// macOS keeps sending the mouse to the window that got the mouse-down while
// the button is held, so the source window must stay open (and is not
// hidden) until release: when its only tab goes elsewhere it is made fully
// transparent instead, and closed on release.

interface DragSession {
  projectId: string
  sourceId: string
  /** Where in the tab the pointer grabbed it. */
  grab: Point
  /** Layouts before the drag, for Escape. */
  snapshot: LayoutEntry[]
  sourceBounds: WindowBounds
  /** The window showing the tab right now. */
  holderId: string
  /** True while the tab is torn off; its holder follows the cursor. */
  detached: boolean
  /** The window created for the torn-off tab, if any (hidden while the tab is attached elsewhere). */
  spareId: string | null
  /** The source is transparent because its only tab is in another window. */
  sourceHidden: boolean
  lastCursor: Point | null
  lastPosition: Point | null
  timer: ReturnType<typeof setInterval>
}

/** Cursor poll rate during a drag (~60fps; also throttles window moves). */
const DRAG_POLL_MS = 16

function liveRecord(id: string | null | undefined): WindowRecord | undefined {
  const r = id ? records.get(id) : undefined
  return r && !r.win.isDestroyed() ? r : undefined
}

function tabsOf(windowId: string): string[] {
  return layouts.find((w) => w.id === windowId)?.projectIds ?? []
}

function stripOf(windowId: string): TabStripGeometry {
  return strips.get(windowId) ?? DEFAULT_TAB_STRIP
}

function isGeometry(g: unknown): g is TabStripGeometry {
  if (!g || typeof g !== 'object') return false
  const v = g as Record<string, unknown>
  return ['left', 'top', 'height', 'tabWidth', 'slot'].every(
    (k) => typeof v[k] === 'number' && Number.isFinite(v[k] as number)
  )
}

/** A renderer measured its tab strip (on mount, resize, or when its tabs change). */
export function reportTabStrip(sender: WebContents | undefined, geometry: unknown): void {
  const rec = recordForSender(sender)
  if (!rec || !isGeometry(geometry)) return
  const { left, top, height, tabWidth, slot } = geometry
  strips.set(rec.id, { left, top, height, tabWidth, slot })
}

/** Windows the dragged tab could drop into, front-most (roughly) first. */
function dropCandidates(d: DragSession): DragWindow[] {
  return liveRecords()
    .filter((r) => r.win.isVisible())
    .filter((r) => r.id !== d.spareId) // the torn-off holder, or hidden
    .filter((r) => !(d.detached && r.id === d.holderId)) // the source following the cursor
    .filter((r) => !(d.sourceHidden && r.id === d.sourceId))
    .sort((a, b) => Number(b.win.isFocused()) - Number(a.win.isFocused()) || b.focusedAt - a.focusedAt)
    .map((r) => ({
      id: r.id,
      bounds: r.win.getContentBounds(),
      strip: stripOf(r.id),
      tabCount: tabsOf(r.id).filter((p) => p !== d.projectId).length,
    }))
}

/** Move the dragged tab from its holder into `toId` at `index` (a reorder when they match). */
function moveDraggedTab(d: DragSession, toId: string, index: number): void {
  const from = d.holderId
  layouts = moveProject(layouts, d.projectId, from, toId, index)
  d.holderId = toId
  sendLayout(toId)
  if (from !== toId) sendLayout(from)
}

function attachDraggedTab(d: DragSession, toId: string, index: number): void {
  const from = d.holderId
  moveDraggedTab(d, toId, index)
  d.detached = false
  if (from === d.spareId) liveRecord(from)?.win.hide()
  if (from === d.sourceId && tabsOf(d.sourceId).length === 0) {
    liveRecord(d.sourceId)?.win.setOpacity(0)
    d.sourceHidden = true
  }
}

function detachDraggedTab(d: DragSession, cursor: Point): void {
  const source = liveRecord(d.sourceId)
  if (!source) return
  d.detached = true
  d.lastPosition = null
  // The source's only tab: the source window itself follows the cursor.
  if (tabsOf(d.sourceId).every((p) => p === d.projectId)) {
    if (d.holderId !== d.sourceId) moveDraggedTab(d, d.sourceId, 0)
    if (d.sourceHidden) {
      source.win.setOpacity(1)
      d.sourceHidden = false
    }
    return
  }
  const pos = detachedWindowPosition(cursor, d.grab, stripOf(d.sourceId))
  const spare = liveRecord(d.spareId)
  if (spare) {
    moveDraggedTab(d, spare.id, 0)
    spare.win.setPosition(pos.x, pos.y)
    spare.win.showInactive()
  } else {
    const from = d.holderId
    layouts = removeProjectFromWindow(layouts, from, d.projectId)
    sendLayout(from)
    const { width, height } = source.win.getBounds()
    const rec = openNewWindow([d.projectId], { ...pos, width, height }, { showInactive: true })
    d.spareId = rec.id
    d.holderId = rec.id
  }
  d.lastPosition = pos
}

function followCursor(d: DragSession, cursor: Point): void {
  const holder = liveRecord(d.holderId)
  if (!holder) return
  const pos = detachedWindowPosition(cursor, d.grab, stripOf(d.sourceId))
  if (d.lastPosition && d.lastPosition.x === pos.x && d.lastPosition.y === pos.y) return
  holder.win.setPosition(pos.x, pos.y)
  d.lastPosition = pos
}

function dragTick(): void {
  const d = drag
  if (!d) return
  if (!liveRecord(d.sourceId) || !liveRecord(d.holderId)) {
    finishDrag({ cancel: false, copy: false })
    return
  }
  const cursor = screen.getCursorScreenPoint()
  if (d.lastCursor && d.lastCursor.x === cursor.x && d.lastCursor.y === cursor.y) return
  d.lastCursor = { x: cursor.x, y: cursor.y }

  const target = findDropTarget(cursor, d.grab.x, dropCandidates(d), d.detached ? null : d.holderId)
  if (!target) {
    if (!d.detached) detachDraggedTab(d, cursor)
    followCursor(d, cursor)
  } else if (!d.detached && target.windowId === d.holderId) {
    if (tabsOf(d.holderId).indexOf(d.projectId) !== target.index) moveDraggedTab(d, d.holderId, target.index)
  } else {
    attachDraggedTab(d, target.windowId, target.index)
  }
}

/** The pointer pressed on a tab in `sender`'s window has moved far enough to drag it. */
export function startTabDrag(sender: WebContents | undefined, projectId: string, grab: Point | undefined): void {
  const source = recordForSender(sender)
  if (!source) return
  if (drag) finishDrag({ cancel: false, copy: false })
  const tabs = tabsOf(source.id)
  if (!tabs.includes(projectId)) return
  drag = {
    projectId,
    sourceId: source.id,
    grab: { x: Number(grab?.x) || 0, y: Number(grab?.y) || 0 },
    snapshot: layouts.map((w) => ({ ...w, projectIds: [...w.projectIds] })),
    sourceBounds: source.win.getBounds(),
    holderId: source.id,
    detached: false,
    spareId: null,
    sourceHidden: false,
    lastCursor: null,
    lastPosition: null,
    timer: setInterval(dragTick, DRAG_POLL_MS),
  }
  // Dragging a tab selects it, as in Chrome.
  layouts = addProjectToWindow(layouts, source.id, projectId, tabs.indexOf(projectId))
  sendLayout(source.id)
}

/** The source renderer saw the pointer released (or Escape: `cancel`). */
export function endTabDrag(
  sender: WebContents | undefined,
  opts: { cancel?: boolean; copy?: boolean } | undefined
): void {
  if (!drag) return
  const rec = recordForSender(sender)
  if (!rec || rec.id !== drag.sourceId) return
  finishDrag({ cancel: !!opts?.cancel, copy: !!opts?.copy })
}

function finishDrag({ cancel, copy }: { cancel: boolean; copy: boolean }): void {
  const d = drag
  if (!d) return
  clearInterval(d.timer)
  drag = null
  const source = liveRecord(d.sourceId)
  const spare = liveRecord(d.spareId)

  if (cancel) {
    const touched = new Set([...layouts, ...d.snapshot].map((w) => w.id))
    layouts = d.snapshot.filter((w) => records.has(w.id))
    spare?.win.close()
    if (source) {
      source.win.setOpacity(1)
      source.win.setBounds(d.sourceBounds)
    }
    for (const id of touched) sendLayout(id)
    persistSoon()
    return
  }

  if (spare && spare.id !== d.holderId) spare.win.close()
  // Option/Alt at release: copy, keeping the tab in its old window too.
  if (copy && source && d.holderId !== d.sourceId && !tabsOf(d.sourceId).includes(d.projectId)) {
    const before = d.snapshot.find((w) => w.id === d.sourceId)
    const at = Math.max(0, before?.projectIds.indexOf(d.projectId) ?? 0)
    const ids = tabsOf(d.sourceId)
    layouts = setWindowTabs(
      layouts,
      d.sourceId,
      [...ids.slice(0, at), d.projectId, ...ids.slice(at)],
      before?.activeProjectId ?? d.projectId
    )
    source.win.setOpacity(1)
    sendLayout(d.sourceId)
  }
  const holder = liveRecord(d.holderId)
  if (holder) focusRecord(holder)
  persistSoon()
  closeEmptyWindows()
}

/** True while a tab drag is in progress. */
export function isTabDragActive(): boolean {
  return drag !== null
}

// ── Hooks from the project / session handlers ─────────────────────────────

/** A project was added from `sender`'s window: open it there. */
export function projectAdded(sender: WebContents | undefined, projectId: string): void {
  const rec = recordForSender(sender) ?? lastFocusedRecord()
  if (!rec) return
  layouts = addProjectToWindow(layouts, rec.id, projectId)
  persistSoon()
  sendLayout(rec.id)
}

/** A project was removed from the app: close its tab in every window. */
export function projectRemoved(projectId: string): void {
  const affected = layouts.filter((w) => w.projectIds.includes(projectId)).map((w) => w.id)
  layouts = removeProjectEverywhere(layouts, projectId)
  persistSoon()
  for (const id of affected) sendLayout(id)
  closeEmptyWindows()
}

/**
 * The window to bring forward for a notification about `projectId`: one that
 * has it as the active tab, else one that has it open, else the last used.
 */
export function focusWindowForProject(projectId: string | undefined): BrowserWindow | undefined {
  const live = liveRecords()
  const byLayout = (pred: (w: LayoutEntry) => boolean) =>
    projectId ? live.find((r) => layouts.some((w) => w.id === r.id && pred(w))) : undefined
  const rec =
    byLayout((w) => w.activeProjectId === projectId) ??
    byLayout((w) => w.projectIds.includes(projectId!)) ??
    lastFocusedRecord()
  if (!rec) return undefined
  focusRecord(rec)
  return rec.win
}

app?.on?.('before-quit', () => markQuitting())

/** Test-only: reset module state. */
export function __resetForTests(): void {
  records.clear()
  layouts = []
  quitting = false
  if (drag) clearInterval(drag.timer)
  drag = null
  strips.clear()
}
