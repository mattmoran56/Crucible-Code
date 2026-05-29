import { useEffect, useRef } from 'react'
import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { api } from '../api/wsClient'

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

function readTheme(): ITheme {
  return {
    background: cssVar('--color-bg', '#1a1b26'),
    foreground: cssVar('--color-text', '#c0caf5'),
    cursor: cssVar('--color-accent', '#7aa2f7'),
    selectionBackground: cssVar('--color-accent', '#7aa2f7') + '40',
  }
}

/**
 * Attach to an EXISTING terminal in the desktop app. Pulls the recent output
 * tail as backfill (so the user sees what just happened) and then streams new
 * output live. Keystrokes go back over TERMINAL_WRITE. Background colour
 * follows the receiver's selected theme (CSS custom properties).
 */
export function RemoteTerminal({ terminalId }: { terminalId: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)

  useEffect(() => {
    if (!hostRef.current) return

    const term = new Terminal({
      fontFamily: 'Menlo, monospace',
      fontSize: 13,
      theme: readTheme(),
      convertEol: true,
      scrollback: 5000,
    })
    termRef.current = term
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(hostRef.current)
    fit.fit()

    let disposed = false

    api.terminal
      .getBuffer(terminalId)
      .then((buf) => {
        if (disposed) return
        term.write(buf as string)
      })
      .catch(() => {})

    const offData = api.terminal.onData((eventTid, data) => {
      if (eventTid === terminalId) term.write(data)
    })

    term.onData((data) => {
      api.terminal.write(terminalId, data).catch(() => {})
    })

    const resize = () => {
      fit.fit()
      api.terminal.resize(terminalId, term.cols, term.rows).catch(() => {})
    }
    window.addEventListener('resize', resize)
    resize()

    // Re-apply theme whenever the receiver's [data-theme] attribute changes
    // (i.e. the user picks a different theme in the top bar).
    const themeObserver = new MutationObserver(() => {
      term.options.theme = readTheme()
    })
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })

    return () => {
      disposed = true
      offData()
      window.removeEventListener('resize', resize)
      themeObserver.disconnect()
      termRef.current = null
      term.dispose()
    }
  }, [terminalId])

  return <div ref={hostRef} className="flex-1 min-h-0 bg-bg" style={{ padding: 8 }} />
}
