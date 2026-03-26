import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { INTERVENTION_PATTERNS } from '../../../shared/patterns'
import { useNotificationStore } from '../../stores/notificationStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { THEMES } from '../../../shared/themes'

interface UseTerminalOptions {
  terminalId: string | null
  sessionId: string | null
  sessionName: string
  visible?: boolean
}

// Global registry — keeps xterm instances alive for the lifetime of the app
const terminalInstances = new Map<
  string,
  { term: Terminal; fitAddon: FitAddon; attached: boolean }
>()

function getCurrentTerminalTheme() {
  const { theme } = useSettingsStore.getState()
  return THEMES.find((t) => t.name === theme)?.terminal ?? THEMES[0].terminal
}

export function useTerminal({ terminalId, sessionId, sessionName, visible = true }: UseTerminalOptions) {
  const containerRef = useRef<HTMLDivElement>(null)
  const lineBuffer = useRef('')

  // Update terminal theme when app theme changes
  useEffect(() => {
    return useSettingsStore.subscribe((state) => {
      const terminalTheme = THEMES.find((t) => t.name === state.theme)?.terminal ?? THEMES[0].terminal
      for (const { term } of terminalInstances.values()) {
        term.options.theme = terminalTheme
      }
    })
  }, [])

  // Create terminal instance once, attach to DOM once
  useEffect(() => {
    if (!containerRef.current || !terminalId) return

    const existing = terminalInstances.get(terminalId)
    if (existing) {
      // Already created — move DOM element to new container if needed
      if (containerRef.current.children.length === 0 && existing.term.element) {
        containerRef.current.appendChild(existing.term.element)
        existing.attached = true
        // Re-fit after reparenting
        requestAnimationFrame(() => {
          existing.fitAddon.fit()
          const { cols, rows } = existing.term
          window.api.terminal.resize(terminalId, cols, rows)
          existing.term.scrollToBottom()
        })
      }
      return
    }

    // Brand new terminal
    const term = new Terminal({
      theme: getCurrentTerminalTheme(),
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      cursorBlink: true,
      scrollback: 50000,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(new WebLinksAddon())

    term.open(containerRef.current)

    // Send keystrokes to the pty and clear attention status (user is interacting)
    term.onData((data) => {
      window.api.terminal.write(terminalId, data)
      if (sessionId) {
        const store = useNotificationStore.getState()
        const status = store.sessionStatuses.get(sessionId)
        if (status === 'attention') {
          store.clearStatus(sessionId)
        }
      }
    })

    // Track user-initiated scrolls only (wheel/keyboard), not programmatic ones
    let anchoredToBottom = true
    let userScrolling = false

    const el = containerRef.current!
    el.addEventListener('wheel', () => {
      userScrolling = true
      requestAnimationFrame(() => {
        const buf = term.buffer.active
        anchoredToBottom = buf.viewportY >= buf.baseY - 3
        userScrolling = false
      })
    })

    // Also catch keyboard scrolling (Shift+PageUp/Down etc)
    term.onKey(({ domEvent }) => {
      if (domEvent.key === 'PageUp' || domEvent.key === 'PageDown' ||
          (domEvent.shiftKey && (domEvent.key === 'ArrowUp' || domEvent.key === 'ArrowDown'))) {
        requestAnimationFrame(() => {
          const buf = term.buffer.active
          anchoredToBottom = buf.viewportY >= buf.baseY - 3
        })
      }
    })

    // Receive data from pty — always active, even when hidden
    window.api.terminal.onData((id, data) => {
      if (id !== terminalId) return
      term.write(data)
      if (anchoredToBottom && !userScrolling) term.scrollToBottom()

      // Intervention detection
      lineBuffer.current += data
      if (lineBuffer.current.length > 2000) {
        lineBuffer.current = lineBuffer.current.slice(-2000)
      }
      for (const pattern of INTERVENTION_PATTERNS) {
        if (pattern.test(lineBuffer.current)) {
          // Route through the notification system (in-app indicator + conditional OS notification)
          if (sessionId) {
            window.api.notification.triggerForSession(sessionId, sessionName)
          }
          lineBuffer.current = '' // Reset to avoid repeat notifications
          break
        }
      }
    })

    window.api.terminal.onExit((id, code) => {
      if (id !== terminalId) return
      term.writeln(`\r\n[Process exited with code ${code}]`)
    })

    terminalInstances.set(terminalId, { term, fitAddon, attached: true })

    // Initial fit + scroll to bottom
    requestAnimationFrame(() => {
      fitAddon.fit()
      const { cols, rows } = term
      window.api.terminal.resize(terminalId, cols, rows)
      term.scrollToBottom()
    })

    // Never dispose — terminal lives for the lifetime of the app
  }, [terminalId, sessionId, sessionName])

  // Re-fit and scroll to bottom when becoming visible
  useEffect(() => {
    if (!visible || !terminalId) return

    const instance = terminalInstances.get(terminalId)
    if (!instance) return

    // Use multiple frames to let layout fully settle
    const raf = requestAnimationFrame(() => {
      setTimeout(() => {
        instance.fitAddon.fit()
        const { cols, rows } = instance.term
        window.api.terminal.resize(terminalId, cols, rows)
        instance.term.scrollToBottom()
      }, 100)
    })

    return () => cancelAnimationFrame(raf)
  }, [visible, terminalId])

  // Resize observer — only when visible
  useEffect(() => {
    if (!visible || !terminalId || !containerRef.current) return

    const instance = terminalInstances.get(terminalId)
    if (!instance) return

    const observer = new ResizeObserver(() => {
      instance.fitAddon.fit()
      const { cols, rows } = instance.term
      window.api.terminal.resize(terminalId, cols, rows)
    })
    observer.observe(containerRef.current)

    return () => observer.disconnect()
  }, [visible, terminalId])

  return { containerRef }
}
