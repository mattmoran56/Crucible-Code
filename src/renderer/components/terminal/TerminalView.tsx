import React from 'react'
import { useTerminal } from './useTerminal'

interface Props {
  terminalId: string
  sessionName: string
  visible: boolean
}

export function TerminalView({ terminalId, sessionName, visible }: Props) {
  const { containerRef } = useTerminal({ terminalId, sessionName, visible })

  return (
    <div
      className="absolute inset-0"
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
