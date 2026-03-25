import React, { useEffect } from 'react'
import { useTerminalStore } from '../../stores/terminalStore'
import { useSessionStore } from '../../stores/sessionStore'
import { TerminalView } from './TerminalView'
import { getTabBaseType, type WorkspaceTab } from '../../stores/workspaceLayoutStore'

interface Props {
  tabId: WorkspaceTab
  visible: boolean
}

/**
 * Renders a single terminal instance for a dynamic tab (agent:N or terminal:N).
 * Auto-spawns the terminal for the active session when it first becomes visible.
 * Renders all session terminals for this tab (so they persist across session switches).
 */
export function DynamicTerminalPanel({ tabId, visible }: Props) {
  const { activeSessionId, sessions } = useSessionStore()
  const { terminals, spawnDynamicTerminal, getDynamicTerminal } = useTerminalStore()

  const baseType = getTabBaseType(tabId)
  const mode = baseType === 'agent' ? 'claude' as const : 'shell' as const

  // Spawn terminal for the active session if it doesn't exist yet
  useEffect(() => {
    const activeSession = sessions.find((s) => s.id === activeSessionId)
    if (!activeSession) return

    const existing = getDynamicTerminal(tabId, activeSession.id)
    if (!existing) {
      spawnDynamicTerminal(tabId, activeSession.id, activeSession.name, activeSession.worktreePath, mode)
    }
  }, [activeSessionId, tabId, mode, sessions, getDynamicTerminal, spawnDynamicTerminal])

  // Render all terminals for this dynamic tab (across sessions) so they never unmount
  const prefix = `dyn:${tabId}:`
  const allInstances = Object.entries(terminals)
    .filter(([key]) => key.startsWith(prefix))
    .map(([, instance]) => instance)

  if (allInstances.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-xs">
        Starting…
      </div>
    )
  }

  return (
    <div className="flex-1 relative min-h-0">
      {allInstances.map((instance) => (
        <TerminalView
          key={instance.terminalId}
          terminalId={instance.terminalId}
          sessionId={instance.sessionId}
          sessionName={instance.sessionName}
          visible={instance.sessionId === activeSessionId && visible}
        />
      ))}
    </div>
  )
}
