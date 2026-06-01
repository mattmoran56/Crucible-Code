import { BrowserWindow, Notification } from 'electron'
import { IPC } from '../../shared/constants'
import { eventBus } from './event-bus'

let mainWindow: BrowserWindow | null = null

export function setNotificationWindow(window: BrowserWindow) {
  mainWindow = window
}

export interface NotificationFocusTarget {
  contextId: string
  tabId: string
}

export function showNotification(
  title: string,
  body: string,
  focus?: NotificationFocusTarget
): void {
  const notification = new Notification({ title, body })
  if (focus) {
    notification.on('click', () => {
      const w = mainWindow
      if (!w || w.isDestroyed()) return
      if (w.isMinimized()) w.restore()
      w.show()
      w.focus()
      w.webContents.send(IPC.NOTIFICATION_FOCUS_REQUEST, focus.contextId, focus.tabId)
    })
  }
  notification.show()

  // Forward to any connected remote receivers. The bridge subscribes to
  // every IPC channel on the bus and fans the args out as an event frame,
  // so a remote PWA receives the same title/body and can display it via
  // the Notification API.
  eventBus.emit(IPC.NOTIFICATION_SHOW, title, body, focus ?? null)
}
