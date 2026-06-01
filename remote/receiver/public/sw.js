// Minimal service worker for Crucible Code Remote PWA.
// Required so iOS 16.4+ treats this as an installable PWA when added to home screen.
// Strategy: network-first, no offline caching for v1.

const SW_VERSION = 'crucible-remote-v1'

self.addEventListener('install', (event) => {
  // Activate immediately — skip waiting so updates take effect on next load.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

// Notification tap: focus an existing PWA tab if any, otherwise open one.
// Honours a `data.url` on the notification (set by the page-side displayer
// and by future Web Push payloads) so taps land on the right session.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of all) {
        // Same-origin match → reuse the tab and post the focus target so the
        // app can route to it without reload.
        if (new URL(client.url).origin === self.location.origin) {
          await client.focus()
          client.postMessage({ type: 'notification-click', data: event.notification.data })
          return
        }
      }
      await self.clients.openWindow(targetUrl)
    })(),
  )
})

// Web Push handler. The relay backend can fire push messages to a stored
// subscription so notifications arrive even when the PWA tab is closed.
// Payload contract: { title, body, url?, focus? }. Falls back to a generic
// notification when the push has no payload (some browsers strip it).
self.addEventListener('push', (event) => {
  let payload = { title: 'Crucible Code', body: 'New activity', url: '/' }
  if (event.data) {
    try {
      payload = { ...payload, ...event.data.json() }
    } catch {
      payload.body = event.data.text() || payload.body
    }
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.focus
        ? `focus:${payload.focus.contextId}:${payload.focus.tabId}`
        : 'crucible-remote',
      data: { url: payload.url || '/', focus: payload.focus },
      icon: '/icon.png',
      badge: '/icon.png',
    }),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request

  // Only handle GET. Let everything else (POST, WS upgrades, etc.) pass through.
  if (request.method !== 'GET') return

  // Skip cross-origin and non-http(s) — let the browser handle them directly.
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (!url.protocol.startsWith('http')) return

  // Network-first, no fallback cache. The point of this SW is installability,
  // not offline support — that's a future ticket.
  event.respondWith(
    fetch(request).catch(() => {
      // If the network fails and it's a navigation, return a minimal offline response
      // so the standalone PWA doesn't show a browser error chrome.
      if (request.mode === 'navigate') {
        return new Response(
          '<!doctype html><meta charset=utf-8><title>Offline</title><body style="background:#1a1b26;color:#c0caf5;font-family:system-ui;padding:2rem"><h1>Offline</h1><p>Reconnect to load Crucible Code Remote.</p></body>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
        )
      }
      return new Response('', { status: 504 })
    }),
  )
})
