import React, { useEffect } from 'react'
import { useTerminalStore } from '../../stores/terminalStore'
import { useSessionStore } from '../../stores/sessionStore'
import { TerminalView } from './TerminalView'

interface Props {
  mode?: 'shell' | 'claude'
  visible?: boolean
}

export function TerminalPanel({ mode = 'shell', visible = true }: Props) {
  const { activeSessionId, sessions } = useSessionStore()
  const { terminals, spawnTerminal, getTerminal } = useTerminalStore()

  // Ensure every session gets a terminal spawned when it becomes active
  useEffect(() => {
    const activeSession = sessions.find((s) => s.id === activeSessionId)
    if (!activeSession) return

    const existing = getTerminal(activeSession.id, mode)
    if (!existing) {
      spawnTerminal(activeSession.id, activeSession.worktreePath, mode)
    }
  }, [activeSessionId, mode, sessions, getTerminal, spawnTerminal])

  if (sessions.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-xs">
        Select a session to get started
      </div>
    )
  }

  // Render a TerminalView for every session that has a terminal of this mode.
  // All stay mounted; only the active one is visible.
  return (
    <div className="flex-1 relative min-h-0">
      {sessions.map((session) => {
        const instance = getTerminal(session.id, mode)
        if (!instance) return null

        const isActive = session.id === activeSessionId && visible

        return (
          <TerminalView
            key={instance.terminalId}
            terminalId={instance.terminalId}
            sessionName={session.name}
            visible={isActive}
          />
        )
      })}
    </div>
  )
}
