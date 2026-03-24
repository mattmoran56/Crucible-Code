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
      spawnTerminal(activeSession.id, activeSession.name, activeSession.worktreePath, mode)
    }
  }, [activeSessionId, mode, sessions, getTerminal, spawnTerminal])

  // Render ALL terminals of this mode (across all projects) so they never
  // unmount during project switches — mirrors the within-project pattern
  // where all session terminals stay mounted and toggle visibility.
  const allInstances = Object.values(terminals).filter((t) => t.mode === mode)

  if (sessions.length === 0 && allInstances.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-xs">
        Select a session to get started
      </div>
    )
  }

  return (
    <div className="flex-1 relative min-h-0">
      {allInstances.map((instance) => {
        const isActive = instance.sessionId === activeSessionId && visible

        return (
          <TerminalView
            key={instance.terminalId}
            terminalId={instance.terminalId}
            sessionId={instance.sessionId}
            sessionName={instance.sessionName}
            visible={isActive}
          />
        )
      })}
    </div>
  )
}
