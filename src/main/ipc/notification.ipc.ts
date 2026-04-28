import { ipcMain } from 'electron'
import { IPC } from '../../shared/constants'
import type { HookType } from '../../shared/types'
import { showNotification } from '../services/notification.service'
import {
  getNotificationServerPort,
  registerContextMapping,
  removeContextMapping,
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

  // Renderer fallback path. Caller passes contextId/tabId directly.
  ipcMain.handle(
    IPC.NOTIFICATION_HOOK_EVENT,
    async (_e, contextId: string, tabId: string, hookType?: string) => {
      handleHookEvent(contextId, tabId || 'agent', (hookType || 'notification') as HookType)
    }
  )
}

export { registerContextMapping, removeContextMapping }
