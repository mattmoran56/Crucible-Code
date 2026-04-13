// Assign mock API to window BEFORE any renderer code loads.
// This must happen synchronously before React renders, since stores
// and hooks access window.api immediately.
import { mockApi } from './mockApi'
;(window as any).api = mockApi

// Now import and render the real app
import React from 'react'
import ReactDOM from 'react-dom/client'
import '@xterm/xterm/css/xterm.css'
import '../src/renderer/styles/globals.css'
import App from '../src/renderer/App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
