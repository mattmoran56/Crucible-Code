import { createRoot } from 'react-dom/client'
import '@xterm/xterm/css/xterm.css'
import '@renderer/styles/globals.css'
import { App } from './App'
import { applyStoredTheme } from './components/ThemePicker'

applyStoredTheme()

createRoot(document.getElementById('root')!).render(<App />)
