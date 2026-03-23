import { ipcMain } from 'electron'
import { IPC } from '../../shared/constants'
import { showNotification } from '../services/notification.service'
import {
  setActiveContext,
  getNotificationServerPort,
  registerSessionMapping,
  removeSessionMapping,
  handleNotificationForSession,
} from '../services/notification-server'

export function registerNotificationHandlers() {
  ipcMain.handle(IPC.NOTIFICATION_SHOW, async (_e, title: string, body: string) => {
    showNotification(title, body)
  })

  ipcMain.handle(IPC.NOTIFICATION_GET_PORT, async () => {
    return getNotificationServerPort()
  })

  ipcMain.handle(
    IPC.FOCUS_SET_ACTIVE_CONTEXT,
    async (_e, projectId: string | null, sessionId: string | null) => {
      setActiveContext({ projectId, sessionId })
    }
  )

  // Called by the renderer when a pattern-match notification fires (fallback path)
  ipcMain.handle(
    IPC.NOTIFICATION_HOOK_EVENT,
    async (_e, sessionId: string, sessionName: string) => {
      handleNotificationForSession(sessionId, sessionName)
    }
  )
}

export { registerSessionMapping, removeSessionMapping }
