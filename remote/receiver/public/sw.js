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
