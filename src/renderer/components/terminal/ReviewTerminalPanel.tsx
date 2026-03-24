import React, { useEffect, useRef } from 'react'
import { useTerminalStore } from '../../stores/terminalStore'
import { useSessionStore } from '../../stores/sessionStore'
import { TerminalView } from './TerminalView'

interface Props {
  visible?: boolean
}

export function ReviewTerminalPanel({ visible = true }: Props) {
  const { activeSessionId, activePRNumber, sessions } = useSessionStore()
  const { spawnTerminal, getTerminal, killTerminal } = useTerminalStore()
  const sentCommandRef = useRef<string | null>(null)

  // Spawn a review terminal and send /review command
  useEffect(() => {
    const activeSession = sessions.find((s) => s.id === activeSessionId)
    if (!activeSession || activePRNumber == null) return

    const existing = getTerminal(activeSession.id, 'review')
    const commandKey = `${activeSession.id}:${activePRNumber}`

    if (!existing) {
      sentCommandRef.current = null
      spawnTerminal(activeSession.id, activeSession.name, activeSession.worktreePath, 'review').then(
        (terminalId) => {
          if (sentCommandRef.current !== commandKey) {
            // Wait briefly for claude to initialize, then send the review command
            setTimeout(() => {
              window.api.terminal.write(terminalId, `/review ${activePRNumber}\n`)
              sentCommandRef.current = commandKey
            }, 2000)
          }
        }
      )
    }
  }, [activeSessionId, activePRNumber, sessions, getTerminal, spawnTerminal])

  // Kill the review terminal when PR changes or closes
  useEffect(() => {
    return () => {
      const session = useSessionStore.getState().sessions.find(
        (s) => s.id === useSessionStore.getState().activeSessionId
      )
      if (session) {
        const existing = useTerminalStore.getState().getTerminal(session.id, 'review')
        if (existing) {
          useTerminalStore.getState().killTerminal(session.id, 'review')
        }
      }
    }
  }, [activePRNumber])

  if (!activeSessionId || activePRNumber == null) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-xs">
        Open a PR to start a review
      </div>
    )
  }

  const activeSession = sessions.find((s) => s.id === activeSessionId)
  if (!activeSession) return null

  const instance = getTerminal(activeSession.id, 'review')
  if (!instance) return null

  return (
    <div className="flex-1 relative min-h-0">
      <TerminalView
        key={instance.terminalId}
        terminalId={instance.terminalId}
        sessionId={activeSession.id}
        sessionName={activeSession.name}
        visible={visible}
      />
    </div>
  )
}
