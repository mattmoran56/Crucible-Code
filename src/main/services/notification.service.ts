import { BrowserWindow, Notification } from 'electron'
import { IPC } from '../../shared/constants'

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
}
