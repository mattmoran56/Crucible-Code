import type { BrowserWindow } from 'electron'
import Store from 'electron-store'
import { IPC } from '../../shared/constants'
import type { QueuedSession, QueuedMessage } from '../../shared/types'
import { getStorePath } from '../store-path'

interface SchedulerStoreShape {
  queuedSessions: QueuedSession[]
  queuedMessages: QueuedMessage[]
}

const store = new Store<SchedulerStoreShape>({
  cwd: getStorePath(),
  name: 'scheduler',
  defaults: {
    queuedSessions: [],
    queuedMessages: [],
  },
})

const sessionTimers = new Map<string, ReturnType<typeof setTimeout>>()
const messageTimers = new Map<string, ReturnType<typeof setTimeout>>()
let mainWindow: BrowserWindow | null = null

function getQueuedSessions(): QueuedSession[] {
  return store.get('queuedSessions', [])
}

function getQueuedMessages(): QueuedMessage[] {
  return store.get('queuedMessages', [])
}

function setQueuedSessions(list: QueuedSession[]): void {
  store.set('queuedSessions', list)
  mainWindow?.webContents.send(IPC.SCHEDULER_QUEUED_SESSIONS_UPDATE, list)
}

function setQueuedMessages(list: QueuedMessage[]): void {
  store.set('queuedMessages', list)
  mainWindow?.webContents.send(IPC.SCHEDULER_QUEUED_MESSAGES_UPDATE, list)
}

function clearSessionTimer(id: string): void {
  const t = sessionTimers.get(id)
  if (t) {
    clearTimeout(t)
    sessionTimers.delete(id)
  }
}

function clearMessageTimer(id: string): void {
  const t = messageTimers.get(id)
  if (t) {
    clearTimeout(t)
    messageTimers.delete(id)
  }
}

function fireQueuedSession(id: string): void {
  const list = getQueuedSessions()
  const item = list.find((s) => s.id === id)
  if (!item) return
  // Remove from queue first so renderer never sees a queued+fired duplicate.
  setQueuedSessions(list.filter((s) => s.id !== id))
  clearSessionTimer(id)
  mainWindow?.webContents.send(IPC.SCHEDULER_FIRE_QUEUED_SESSION, item)
}

function fireQueuedMessage(id: string): void {
  const list = getQueuedMessages()
  const item = list.find((m) => m.id === id)
  if (!item) return
  setQueuedMessages(list.filter((m) => m.id !== id))
  clearMessageTimer(id)
  mainWindow?.webContents.send(IPC.SCHEDULER_FIRE_QUEUED_MESSAGE, item)
}

// On rehydrate after app startup, past-due items would naturally fire at
// delay=0 — but the renderer's onFireQueuedSession listener is registered in
// a useEffect that runs after the renderer mounts. We add a small buffer so
// the renderer is definitely subscribed before we send the fire event.
const RENDERER_READY_BUFFER_MS = 2500

function computeFireDelay(scheduledFor: number): number {
  const MAX_DELAY = 2_147_483_000
  const natural = scheduledFor - Date.now()
  if (natural < 0) return RENDERER_READY_BUFFER_MS
  return Math.min(MAX_DELAY, natural)
}

function scheduleSession(item: QueuedSession): void {
  clearSessionTimer(item.id)
  const delay = computeFireDelay(item.scheduledFor)
  const timer = setTimeout(() => fireQueuedSession(item.id), delay)
  sessionTimers.set(item.id, timer)
}

function scheduleMessage(item: QueuedMessage): void {
  clearMessageTimer(item.id)
  const delay = computeFireDelay(item.scheduledFor)
  const timer = setTimeout(() => fireQueuedMessage(item.id), delay)
  messageTimers.set(item.id, timer)
}

export function startScheduler(window: BrowserWindow): void {
  mainWindow = window
  // Rehydrate timers — items whose scheduledFor has passed fire immediately
  // (Math.max above clamps the delay to 0).
  for (const item of getQueuedSessions()) {
    scheduleSession(item)
  }
  for (const item of getQueuedMessages()) {
    scheduleMessage(item)
  }
}

export function stopScheduler(): void {
  for (const t of sessionTimers.values()) clearTimeout(t)
  for (const t of messageTimers.values()) clearTimeout(t)
  sessionTimers.clear()
  messageTimers.clear()
  mainWindow = null
}

export function listQueuedSessions(): QueuedSession[] {
  return getQueuedSessions()
}

export function listQueuedMessages(): QueuedMessage[] {
  return getQueuedMessages()
}

export function addQueuedSession(item: QueuedSession): QueuedSession[] {
  const list = getQueuedSessions().filter((s) => s.id !== item.id)
  list.push(item)
  setQueuedSessions(list)
  scheduleSession(item)
  return list
}

export function cancelQueuedSession(id: string): QueuedSession[] {
  clearSessionTimer(id)
  const list = getQueuedSessions().filter((s) => s.id !== id)
  setQueuedSessions(list)
  return list
}

export function rescheduleQueuedSession(id: string, scheduledFor: number): QueuedSession[] {
  const list = getQueuedSessions()
  const idx = list.findIndex((s) => s.id === id)
  if (idx < 0) return list
  const updated: QueuedSession = { ...list[idx], scheduledFor }
  list[idx] = updated
  setQueuedSessions(list)
  scheduleSession(updated)
  return list
}

export function fireQueuedSessionNow(id: string): void {
  fireQueuedSession(id)
}

export function addQueuedMessage(item: QueuedMessage): QueuedMessage[] {
  // Dedupe by sessionId — only one queued message per session at a time.
  // Replacing keeps the latest user intent (e.g. user re-queues with a different
  // message after the first one).
  const list = getQueuedMessages().filter(
    (m) => m.sessionId !== item.sessionId && m.id !== item.id
  )
  // Cancel any pre-existing timer for the displaced message(s) of this session.
  for (const existing of getQueuedMessages()) {
    if (existing.sessionId === item.sessionId || existing.id === item.id) {
      clearMessageTimer(existing.id)
    }
  }
  list.push(item)
  setQueuedMessages(list)
  scheduleMessage(item)
  return list
}

export function cancelQueuedMessage(id: string): QueuedMessage[] {
  clearMessageTimer(id)
  const list = getQueuedMessages().filter((m) => m.id !== id)
  setQueuedMessages(list)
  return list
}
