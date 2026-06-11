import { useEffect } from 'react'
import { useSettingsStore } from '../stores/settingsStore'

/**
 * Cmd+, (macOS) / Ctrl+, (other platforms) toggles the settings page.
 */
export function useSettingsShortcut() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== ',') return
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.shiftKey || e.altKey) return
      e.preventDefault()
      const { isOpen, openSettings, closeSettings } = useSettingsStore.getState()
      if (isOpen) closeSettings()
      else openSettings()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
}
