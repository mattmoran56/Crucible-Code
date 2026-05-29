import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { api } from '../api/wsClient'

/**
 * Attach to an EXISTING terminal in the desktop app. Pulls the recent output
 * tail as backfill (so the user sees what just happened) and then streams new
 * output live. Keystrokes go back over TERMINAL_WRITE.
 */
export function RemoteTerminal({ terminalId }: { terminalId: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!hostRef.current) return

    const term = new Terminal({
      fontFamily: 'Menlo, monospace',
      fontSize: 13,
      theme: { background: '#1a1a1a' },
      convertEol: true,
      scrollback: 5000,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(hostRef.current)
    fit.fit()

    let disposed = false

    // Backfill first, THEN start subscribing — keeps the stream coherent.
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

    return () => {
      disposed = true
      offData()
      window.removeEventListener('resize', resize)
      term.dispose()
    }
  }, [terminalId])

  return (
    <div
      ref={hostRef}
      style={{
        flex: 1,
        background: '#1a1a1a',
        padding: 8,
        borderRadius: 6,
        minHeight: 0,
      }}
    />
  )
}
