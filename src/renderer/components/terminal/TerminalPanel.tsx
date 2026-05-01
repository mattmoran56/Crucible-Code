import React, { useEffect } from 'react'
import { useTerminalStore } from '../../stores/terminalStore'
import { useSessionStore } from '../../stores/sessionStore'
import { TerminalView } from './TerminalView'

interface Props {
  mode?: 'shell' | 'claude'
  visible?: boolean
}

// Wait for Claude's prompt indicator on the freshly-spawned PTY, then write the
// startup command. Mirrors the prompt-detection-then-write trick used by custom
// buttons in foreground 'claude' mode.
function writeStartupCommandWhenReady(terminalId: string, command: string) {
  let sent = false
  const finish = () => {
    if (sent) return
    sent = true
    unsub()
    window.api.terminal.write(terminalId, command + '\r')
  }
  const unsub = window.api.terminal.onData((tid: string, data: string) => {
    if (tid !== terminalId || sent) return
    if (data.includes('>') || data.includes('$')) {
      sent = true
      unsub()
      setTimeout(() => window.api.terminal.write(terminalId, command + '\r'), 100)
    }
  })
  setTimeout(finish, 10000)
}

export function TerminalPanel({ mode = 'shell', visible = true }: Props) {
  const { activeSessionId, sessions } = useSessionStore()
  const { terminals, spawnTerminal, getTerminal } = useTerminalStore()

  // Ensure every session gets a terminal spawned when it becomes active
  useEffect(() => {
    const activeSession = sessions.find((s) => s.id === activeSessionId)
    if (!activeSession) return

    const existing = getTerminal(activeSession.id, mode)
    if (existing) return

    const sessionId = activeSession.id
    spawnTerminal(
      sessionId,
      activeSession.name,
      activeSession.worktreePath,
      mode,
      false,
      sessionId,
      'agent'
    ).then((terminalId) => {
      if (mode !== 'claude') return
      const command = useSessionStore.getState().consumePendingStartup(sessionId)
      if (command) writeStartupCommandWhenReady(terminalId, command)
    })
  }, [activeSessionId, mode, sessions, getTerminal, spawnTerminal])

  // Render only PRIMARY (non-dynamic) terminals of this mode across all projects
  // so they never unmount during project switches. Dynamic terminals are rendered
  // by DynamicTerminalPanel — filtering them out here prevents two TerminalView
  // components from fighting over the same xterm DOM element (which causes the
  // first terminal to freeze/go blank when a second agent tab is opened).
  const allInstances = Object.entries(terminals)
    .filter(([key, t]) => t.mode === mode && !key.startsWith('dyn:'))
    .map(([, instance]) => instance)

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
