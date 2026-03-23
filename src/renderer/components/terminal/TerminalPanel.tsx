import React, { useEffect, useState } from 'react'
import { useTerminalStore } from '../../stores/terminalStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useTerminal } from './useTerminal'

export function TerminalPanel() {
  const { activeSessionId, sessions } = useSessionStore()
  const { terminals, spawnTerminal } = useTerminalStore()
  const [terminalId, setTerminalId] = useState<string | null>(null)

  const activeSession = sessions.find((s) => s.id === activeSessionId)

  useEffect(() => {
    if (!activeSession) {
      setTerminalId(null)
      return
    }

    const existing = terminals[activeSession.id]
    if (existing) {
      setTerminalId(existing.terminalId)
    } else {
      spawnTerminal(activeSession.id, activeSession.worktreePath).then(setTerminalId)
    }
  }, [activeSession, terminals, spawnTerminal])

  const { containerRef } = useTerminal({
    terminalId,
    sessionId: activeSession?.id ?? null,
    sessionName: activeSession?.name ?? '',
  })

  if (!activeSession) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-xs">
        Select a session to open a terminal
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-3 py-1.5 bg-bg-tertiary border-t border-border flex items-center gap-2 text-xs">
        <span className="text-text-muted">Terminal</span>
        <span className="text-text-muted">—</span>
        <span className="text-text truncate">{activeSession.worktreePath}</span>
      </div>
      <div ref={containerRef} className="flex-1 min-h-0 p-1" />
    </div>
  )
}
