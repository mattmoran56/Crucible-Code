import { useSyncExternalStore } from 'react'
import { IPC } from '@protocol/channels'
import { wsClient } from './wsClient'

interface FocusTarget {
  contextId: string
  tabId: string
}

let initialised = false
const permissionSubs = new Set<() => void>()

function currentPermission(): NotificationPermission {
  if (!('Notification' in window)) return 'denied'
  return Notification.permission
}

function notifyPermissionChange(): void {
  for (const cb of permissionSubs) cb()
}

/**
 * Ask for Notification permission. MUST be called from a user gesture
 * (click handler) — iOS Safari silently denies prompts triggered from
 * timers, effects, or event-bus callbacks.
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) return 'denied'
  if (Notification.permission !== 'default') return Notification.permission
  try {
    const result = await Notification.requestPermission()
    notifyPermissionChange()
    return result
  } catch {
    return 'denied'
  }
}

export function useNotificationPermission(): NotificationPermission {
  return useSyncExternalStore(
    (cb) => {
      permissionSubs.add(cb)
      return () => permissionSubs.delete(cb)
    },
    currentPermission,
    () => 'default' as NotificationPermission,
  )
}

async function display(title: string, body: string, focus: FocusTarget | null): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('[notifications] display', { title, body, focus, permission: currentPermission() })

  if (currentPermission() !== 'granted') {
    // eslint-disable-next-line no-console
    console.warn('[notifications] permission not granted — tap the bell in the header to enable')
    return
  }

  // Prefer the service worker path: shown in OS notification center, survives
  // page navigation, and is the path that Web Push will eventually use too.
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.ready
      await reg.showNotification(title, {
        body,
        tag: focus ? `focus:${focus.contextId}:${focus.tabId}` : `crucible-remote-${Date.now()}`,
        data: { url: '/', focus },
        icon: '/icon.png',
        badge: '/icon.png',
        // Renotify even if the tag matches an existing one — otherwise the
        // OS suppresses the second "needs attention" if it arrives soon.
        renotify: !!focus,
      })
      return
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[notifications] sw.showNotification failed, falling back', err)
    }
  }
  try {
    new Notification(title, { body, tag: 'crucible-remote' })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[notifications] Notification constructor failed', err)
  }
}

export function initRemoteNotifications(): void {
  if (initialised) return
  initialised = true

  wsClient.on(IPC.NOTIFICATION_SHOW, (...args: unknown[]) => {
    // eslint-disable-next-line no-console
    console.log('[notifications] received NOTIFICATION_SHOW', args)
    const [title, body, focus] = args as [string, string, FocusTarget | null | undefined]
    if (typeof title !== 'string' || typeof body !== 'string') return
    void display(title, body, focus ?? null)
  })
}
