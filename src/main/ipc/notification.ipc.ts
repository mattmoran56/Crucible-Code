import { ipcMain } from 'electron'
import { IPC } from '../../shared/constants'
import type { HookType } from '../../shared/types'
import { showNotification } from '../services/notification.service'
import {
  getNotificationServerPort,
  registerSessionMapping,
  removeSessionMapping,
  handleHookEvent,
  setBadgeCount,
} from '../services/notification-server'

export function registerNotificationHandlers() {
  ipcMain.handle(IPC.NOTIFICATION_SHOW, async (_e, title: string, body: string) => {
    showNotification(title, body)
  })

  ipcMain.handle(IPC.NOTIFICATION_GET_PORT, async () => {
    return getNotificationServerPort()
  })

  ipcMain.handle(IPC.NOTIFICATION_SET_BADGE, async (_e, count: number) => {
    setBadgeCount(count)
  })

  // Called by the renderer as a fallback trigger path
  ipcMain.handle(
    IPC.NOTIFICATION_HOOK_EVENT,
    async (_e, sessionId: string, sessionName: string, hookType?: string) => {
      handleHookEvent(sessionId, sessionName, (hookType || 'notification') as HookType)
    }
  )
}

export { registerSessionMapping, removeSessionMapping }
