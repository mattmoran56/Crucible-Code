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
  containsPoint,
  moveProject,
  reconcileLayouts,
  removeProjectEverywhere,
  removeProjectFromWindow,
  setWindowTabs,
  tearOffBounds,
  type LayoutEntry,
  type WindowBounds,
} from './window-layout'

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

/** Tab drags (by token) a window has already accepted as a drop. */
const handledDrags = new Set<string>()

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

function createAppWindow(entry: LayoutEntry): WindowRecord {
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

  win.once('ready-to-show', () => win.show())
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

function openNewWindow(projectIds: string[], bounds?: WindowBounds): WindowRecord {
  const entry: LayoutEntry = {
    id: randomUUID(),
    projectIds,
    activeProjectId: projectIds[0] ?? null,
    bounds,
  }
  layouts = [...layouts, entry]
  persistSoon()
  return createAppWindow(entry)
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
function applyMove(projectId: string, fromId: string, toId: string, index?: number, copy = false): void {
  layouts = copy ? addProjectToWindow(layouts, toId, projectId, index) : moveProject(layouts, projectId, fromId, toId, index)
  persistSoon()
  sendLayout(toId)
  if (fromId !== toId) sendLayout(fromId)
  const target = records.get(toId)
  if (target) focusRecord(target)
  closeEmptyWindows()
}

/** A window accepted a tab dropped from another window's tab strip. */
export function dropTab(
  sender: WebContents | undefined,
  dragToken: string,
  projectId: string,
  fromWindowId: string,
  index: number,
  copy: boolean
): void {
  const target = recordForSender(sender)
  if (!target) return
  handledDrags.add(dragToken)
  setTimeout(() => handledDrags.delete(dragToken), 5_000)
  if (!layouts.some((w) => w.id === fromWindowId)) {
    // Source window is gone; just open the tab here.
    layouts = addProjectToWindow(layouts, target.id, projectId, index)
    persistSoon()
    sendLayout(target.id)
    return
  }
  applyMove(projectId, fromWindowId, target.id, index, copy)
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

/** Grace period for the drop target's IPC to land before deciding the drag ended outside. */
const DRAG_END_GRACE_MS = 200

/**
 * A tab drag ended in the source window. If no window took the drop, the tab
 * was dropped somewhere else: over another app window it joins that window;
 * outside every window it tears off into a new window under the cursor —
 * like dragging a tab out of Chrome.
 */
export async function tabDragEnded(
  sender: WebContents | undefined,
  dragToken: string,
  projectId: string,
  copy: boolean
): Promise<void> {
  const source = recordForSender(sender)
  if (!source) return
  await new Promise((r) => setTimeout(r, DRAG_END_GRACE_MS))
  if (handledDrags.has(dragToken)) return
  if (source.win.isDestroyed()) return

  const cursor = screen.getCursorScreenPoint()
  if (containsPoint(source.win.getBounds(), cursor)) return // dropped back on its own window

  const over = liveRecords().find((r) => r.id !== source.id && containsPoint(r.win.getBounds(), cursor))
  if (over) {
    applyMove(projectId, source.id, over.id, undefined, copy)
    return
  }

  const sourceEntry = layouts.find((w) => w.id === source.id)
  const size = source.win.getBounds()
  const workArea = screen.getDisplayNearestPoint(cursor).workArea
  const bounds = tearOffBounds(cursor, size, workArea)

  // Dragging a window's only tab out just moves the window (as Chrome does).
  if (!copy && sourceEntry && sourceEntry.projectIds.length === 1 && sourceEntry.projectIds[0] === projectId) {
    source.win.setBounds(bounds)
    return
  }

  openNewWindow([projectId], bounds)
  if (!copy) {
    layouts = removeProjectFromWindow(layouts, source.id, projectId)
    persistSoon()
    sendLayout(source.id)
  }
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
  handledDrags.clear()
}
