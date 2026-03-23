import { ipcMain } from 'electron'
import { IPC } from '../../shared/constants'
import { showNotification } from '../services/notification.service'

export function registerNotificationHandlers() {
  ipcMain.handle(IPC.NOTIFICATION_SHOW, async (_e, title: string, body: string) => {
    showNotification(title, body)
  })
}
