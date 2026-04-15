import { useEffect } from 'react'
import { useButtonStore } from '../stores/buttonStore'

/**
 * Parse an Electron-style accelerator string into modifier flags + key.
 * Examples: "Cmd+Shift+T", "Ctrl+Alt+R", "F5"
 */
function parseAccelerator(shortcut: string): {
  meta: boolean
  ctrl: boolean
  shift: boolean
  alt: boolean
  key: string
} {
  const parts = shortcut.split('+').map((p) => p.trim())
  const key = parts.pop()?.toLowerCase() ?? ''
  const mods = new Set(parts.map((p) => p.toLowerCase()))

  return {
    meta: mods.has('cmd') || mods.has('meta') || mods.has('command'),
    ctrl: mods.has('ctrl') || mods.has('control'),
    shift: mods.has('shift'),
    alt: mods.has('alt') || mods.has('option'),
    key,
  }
}

function matchesShortcut(e: KeyboardEvent, shortcut: string): boolean {
  const parsed = parseAccelerator(shortcut)
  if (parsed.meta !== e.metaKey) return false
  if (parsed.ctrl !== e.ctrlKey) return false
  if (parsed.shift !== e.shiftKey) return false
  if (parsed.alt !== e.altKey) return false
  return e.key.toLowerCase() === parsed.key
}

export function useButtonShortcuts() {
  const buttons = useButtonStore((s) => s.buttons)
  const executeButton = useButtonStore((s) => s.executeButton)

  useEffect(() => {
    const buttonsWithShortcuts = buttons.filter((b) => b.shortcut)
    if (buttonsWithShortcuts.length === 0) return

    const handler = (e: KeyboardEvent) => {
      for (const btn of buttonsWithShortcuts) {
        if (matchesShortcut(e, btn.shortcut!)) {
          e.preventDefault()
          executeButton(btn.id)
          return
        }
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [buttons, executeButton])
}
