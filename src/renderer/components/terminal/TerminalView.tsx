import React, { useCallback } from 'react'
import { useTerminal } from './useTerminal'
import { useNotificationStore } from '../../stores/notificationStore'
import { useTerminalStore } from '../../stores/terminalStore'

interface Props {
  terminalId: string
  sessionId: string
  sessionName: string
  visible: boolean
}

export function TerminalView({ terminalId, sessionId, sessionName, visible }: Props) {
  const { containerRef } = useTerminal({ terminalId, sessionId, sessionName, visible })
  const clearTabStatus = useNotificationStore((s) => s.clearTabStatus)
  const contextStatuses = useNotificationStore((s) => s.contextStatuses)

  const handleInteraction = useCallback(() => {
    // Find this terminal's (contextId, tabId) so we clear *its* attention dot,
    // not the whole context — other agent tabs may still be waiting.
    const terminals = useTerminalStore.getState().terminals
    const instance = Object.values(terminals).find((t) => t.terminalId === terminalId)
    if (!instance) return
    const tabStatus = contextStatuses.get(instance.contextId)?.get(instance.tabId)
    if (tabStatus === 'attention') {
      clearTabStatus(instance.contextId, instance.tabId)
    }
  }, [clearTabStatus, terminalId, contextStatuses])

  return (
    <div
      className="absolute inset-0"
      onClick={handleInteraction}
      onFocus={handleInteraction}
      style={{
        visibility: visible ? 'visible' : 'hidden',
        pointerEvents: visible ? 'auto' : 'none',
        zIndex: visible ? 1 : 0,
      }}
    >
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%', padding: '4px', overflow: 'hidden' }}
      />
    </div>
  )
}
