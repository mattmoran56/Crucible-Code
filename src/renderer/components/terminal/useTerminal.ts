import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { INTERVENTION_PATTERNS } from '../../../shared/patterns'
import { useNotificationStore } from '../../stores/notificationStore'
import { useTerminalStore } from '../../stores/terminalStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useSessionStore } from '../../stores/sessionStore'
import { THEMES } from '../../../shared/themes'
import { attachSmartScroll, type SmartScrollController } from './smartScroll'

interface UseTerminalOptions {
  terminalId: string | null
  sessionId: string | null
  sessionName: string
  visible?: boolean
}

// Global registry — keeps xterm instances alive for the lifetime of the app
const terminalInstances = new Map<
  string,
  { term: Terminal; fitAddon: FitAddon; attached: boolean; visible: boolean; smartScroll: SmartScrollController; unsubData: (() => void) | null; unsubExit: (() => void) | null }
>()

/** Force the xterm viewport scrollbar to sync with the buffer position */
function syncViewportScroll(term: Terminal): void {
  const viewport = term.element?.querySelector('.xterm-viewport') as HTMLElement | null
  if (viewport) {
    viewport.scrollTop = viewport.scrollHeight
  }
}

function getCurrentTerminalTheme() {
  const { theme } = useSettingsStore.getState()
  return THEMES.find((t) => t.name === theme)?.terminal ?? THEMES[0].terminal
}

export function destroyTerminal(terminalId: string): void {
  const instance = terminalInstances.get(terminalId)
  if (!instance) return
  instance.unsubData?.()
  instance.unsubExit?.()
  instance.smartScroll.dispose()
  instance.term.dispose()
  terminalInstances.delete(terminalId)
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
          syncViewportScroll(existing.term)
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
      if (terminalId) {
        const terminals = useTerminalStore.getState().terminals
        const instance = Object.values(terminals).find((t) => t.terminalId === terminalId)
        if (instance) {
          const store = useNotificationStore.getState()
          const status = store.contextStatuses.get(instance.contextId)?.get(instance.tabId)
          if (status === 'attention') {
            store.clearTabStatus(instance.contextId, instance.tabId)
          }
        }
      }
    })

    // Smart scroll: see smartScroll.ts. The controller intercepts writes to
    // preserve the user's scroll position when they have scrolled up.
    const smartScroll = attachSmartScroll(term, () => {
      return terminalInstances.get(terminalId)?.visible ?? false
    })

    // Receive data from pty — always active, even when hidden
    const unsubData = window.api.terminal.onData((id, data) => {
      if (id !== terminalId) return
      smartScroll.write(data)

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

    const unsubExit = window.api.terminal.onExit((id, code) => {
      if (id !== terminalId) return
      term.writeln(`\r\n[Process exited with code ${code}]`)
    })

    terminalInstances.set(terminalId, { term, fitAddon, attached: true, visible: true, smartScroll, unsubData, unsubExit })

    // Initial fit + scroll to bottom
    requestAnimationFrame(() => {
      fitAddon.fit()
      const { cols, rows } = term
      window.api.terminal.resize(terminalId, cols, rows)
      term.scrollToBottom()

      // Auto-focus newly-created session terminals once their xterm is mounted.
      if (sessionId && useSessionStore.getState().consumePendingFocus(sessionId)) {
        term.focus()
      }
    })

    // Never dispose — terminal lives for the lifetime of the app
  }, [terminalId, sessionId, sessionName])

  // Track visibility on the instance so the data handler knows whether to scroll
  useEffect(() => {
    if (!terminalId) return
    const instance = terminalInstances.get(terminalId)
    if (!instance) return
    instance.visible = !!visible
  }, [visible, terminalId])

  // Re-fit and scroll to bottom when becoming visible
  useEffect(() => {
    if (!visible || !terminalId) return

    const instance = terminalInstances.get(terminalId)
    if (!instance) return

    // Fit first, then sync scroll after layout settles
    const raf = requestAnimationFrame(() => {
      instance.fitAddon.fit()
      const { cols, rows } = instance.term
      window.api.terminal.resize(terminalId, cols, rows)

      if (instance.smartScroll.isAnchored()) {
        instance.term.scrollToBottom()
        // Force the viewport scrollbar to match — scrollToBottom alone can desync
        // when the terminal received writes while hidden
        syncViewportScroll(instance.term)

        // Second sync after xterm finishes its own reflow
        requestAnimationFrame(() => {
          instance.term.scrollToBottom()
          syncViewportScroll(instance.term)
        })
      }
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
