import { IPC } from '../../shared/constants'
import { handle } from './handle'
import type { HookType } from '../../shared/types'
import { showNotification } from '../services/notification.service'
import {
  getNotificationServerPort,
  registerContextMapping,
  removeContextMapping,
  handleHookEvent,
  handleCloudWebNotification,
  setBadgeCount,
} from '../services/notification-server'

export function registerNotificationHandlers() {
  handle(IPC.NOTIFICATION_SHOW, async (_e, title: string, body: string) => {
    showNotification(title, body)
  })

  handle(IPC.NOTIFICATION_GET_PORT, async () => {
    return getNotificationServerPort()
  })

  handle(IPC.NOTIFICATION_SET_BADGE, async (_e, count: number) => {
    setBadgeCount(count)
  })

  // A claude.ai page's web notification, attributed to a session by the renderer.
  handle(
    IPC.NOTIFICATION_CLOUD_RELAY,
    async (_e, contextId: string | null, title: string, body: string, kind?: string) => {
      handleCloudWebNotification(
        typeof contextId === 'string' && contextId ? contextId : null,
        String(title ?? ''),
        String(body ?? ''),
        kind === 'completed' ? 'completed' : 'attention'
      )
    }
  )

  // Renderer fallback path. Caller passes contextId/tabId directly.
  handle(
    IPC.NOTIFICATION_HOOK_EVENT,
    async (_e, contextId: string, tabId: string, hookType?: string) => {
      handleHookEvent(contextId, tabId || 'agent', (hookType || 'notification') as HookType)
    }
  )
}

export { registerContextMapping, removeContextMapping }
