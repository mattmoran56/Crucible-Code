import { createRoot } from 'react-dom/client'
import '@xterm/xterm/css/xterm.css'
import '@renderer/styles/globals.css'
import './pwa.css'
import { App } from './App'
import { applyStoredTheme } from './components/ThemePicker'

applyStoredTheme()

// Register the service worker so iOS 16.4+ treats this as an installable PWA.
// Skip on plain http LAN IPs — iOS won't install a PWA there anyway, and a
// half-broken SW (e.g. unregisterable scope) is worse than none.
if ('serviceWorker' in navigator) {
  const isSecure =
    window.location.protocol === 'https:' ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
  if (isSecure) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.warn('[pwa] service worker registration failed', err)
      })
    })
  }
}

createRoot(document.getElementById('root')!).render(<App />)
