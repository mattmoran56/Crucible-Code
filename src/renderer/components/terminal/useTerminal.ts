import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { INTERVENTION_PATTERNS } from '../../../shared/patterns'

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

export function useTerminal({ terminalId, sessionId, sessionName, visible = true }: UseTerminalOptions) {
  const containerRef = useRef<HTMLDivElement>(null)
  const lineBuffer = useRef('')

  // Create terminal instance once, attach to DOM once
  useEffect(() => {
    if (!containerRef.current || !terminalId) return

    const existing = terminalInstances.get(terminalId)
    if (existing) {
      // Already created — if not yet attached to this container, attach
      if (!existing.attached || containerRef.current.children.length === 0) {
        existing.term.open(containerRef.current)
        existing.attached = true
      }
      return
    }

    // Brand new terminal
    const term = new Terminal({
      theme: {
        background: '#1a1b26',
        foreground: '#c0caf5',
        cursor: '#c0caf5',
        selectionBackground: '#33467c',
        black: '#15161e',
        red: '#f7768e',
        green: '#9ece6a',
        yellow: '#e0af68',
        blue: '#7aa2f7',
        magenta: '#bb9af7',
        cyan: '#7dcfff',
        white: '#a9b1d6',
      },
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      cursorBlink: true,
      scrollback: 50000,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(new WebLinksAddon())

    term.open(containerRef.current)

    // Send keystrokes to the pty
    term.onData((data) => {
      window.api.terminal.write(terminalId, data)
    })

    // Receive data from pty — always active, even when hidden
    window.api.terminal.onData((id, data) => {
      if (id !== terminalId) return
      // Only auto-scroll if user is already near the bottom
      const isNearBottom = term.buffer.active.viewportY >= term.buffer.active.baseY - 5
      term.write(data)
      if (isNearBottom) term.scrollToBottom()

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
