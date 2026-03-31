import React, { useCallback, useEffect } from 'react'
import { useTerminalStore } from '../../stores/terminalStore'
import { useSessionStore } from '../../stores/sessionStore'
import { TerminalView } from './TerminalView'
import { IconButton } from '../ui'

interface Props {
  mode?: 'shell' | 'claude'
  visible?: boolean
}

export function TerminalPanel({ mode = 'shell', visible = true }: Props) {
  const { activeSessionId, sessions } = useSessionStore()
  const { terminals, spawnTerminal, getTerminal, killTerminal } = useTerminalStore()

  const handleRestart = useCallback(() => {
    if (activeSessionId) {
      killTerminal(activeSessionId, mode)
    }
  }, [activeSessionId, mode, killTerminal])

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
    <div className="flex-1 flex flex-col min-h-0">
      {activeSessionId && visible && (
        <div className="flex items-center justify-end px-2 py-1 border-b border-border shrink-0">
          <IconButton
            label={`Restart ${mode} terminal`}
            size="sm"
            onClick={handleRestart}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 2v6h-6" />
              <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
              <path d="M3 22v-6h6" />
              <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
            </svg>
          </IconButton>
        </div>
      )}
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
    </div>
  )
}
