import React, { useCallback } from 'react'
import { useTerminal } from './useTerminal'
import { useNotificationStore } from '../../stores/notificationStore'

interface Props {
  terminalId: string
  sessionId: string
  sessionName: string
  visible: boolean
}

export function TerminalView({ terminalId, sessionId, sessionName, visible }: Props) {
  const { containerRef } = useTerminal({ terminalId, sessionId, sessionName, visible })
  const clearPending = useNotificationStore((s) => s.clearPending)

  const handleInteraction = useCallback(() => {
    clearPending(sessionId)
  }, [clearPending, sessionId])

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
