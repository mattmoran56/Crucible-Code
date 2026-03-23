import { useEffect, useRef, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { INTERVENTION_PATTERNS } from '../../../shared/patterns'

interface UseTerminalOptions {
  terminalId: string | null
  sessionId: string | null
  sessionName: string
}

export function useTerminal({ terminalId, sessionId, sessionName }: UseTerminalOptions) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const lineBuffer = useRef('')

  const handleResize = useCallback(() => {
    if (fitAddonRef.current && terminalRef.current && terminalId) {
      fitAddonRef.current.fit()
      const { cols, rows } = terminalRef.current
      window.api.terminal.resize(terminalId, cols, rows)
    }
  }, [terminalId])

  useEffect(() => {
    if (!containerRef.current || !terminalId) return

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
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(new WebLinksAddon())

    term.open(containerRef.current)
    fitAddon.fit()

    terminalRef.current = term
    fitAddonRef.current = fitAddon

    // Send keystrokes to the pty
    term.onData((data) => {
      window.api.terminal.write(terminalId, data)
    })

    // Receive data from pty
    const removeDataListener = window.api.terminal.onData((id, data) => {
      if (id !== terminalId) return
      term.write(data)

      // Intervention detection
      lineBuffer.current += data
      // Keep only last 2000 chars to avoid unbounded growth
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

    const removeExitListener = window.api.terminal.onExit((id, code) => {
      if (id !== terminalId) return
      term.writeln(`\r\n[Process exited with code ${code}]`)
    })

    // Resize observer
    const observer = new ResizeObserver(handleResize)
    observer.observe(containerRef.current)

    // Initial resize after a tick
    requestAnimationFrame(() => {
      fitAddon.fit()
      const { cols, rows } = term
      window.api.terminal.resize(terminalId, cols, rows)
    })

    return () => {
      observer.disconnect()
      removeDataListener()
      removeExitListener()
      term.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [terminalId, sessionId, sessionName, handleResize])

  return { containerRef }
}
