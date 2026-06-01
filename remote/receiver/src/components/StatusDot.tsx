import { useContextStatus, type SessionStatus } from '../api/sessionStatus'

const COLORS: Record<SessionStatus, string> = {
  running: 'var(--color-accent)',
  attention: 'var(--color-warning, #f7768e)',
  completed: 'var(--color-success, #9ece6a)',
}

const LABELS: Record<SessionStatus, string> = {
  running: 'Active',
  attention: 'Needs attention',
  completed: 'Finished',
}

interface Props {
  contextId: string
  size?: number
}

export function SessionStatusDot({ contextId, size = 8 }: Props) {
  const status = useContextStatus(contextId)
  if (!status) {
    // Reserve the space so labels don't jitter when a status appears.
    return <span style={{ width: size, height: size, display: 'inline-block' }} aria-hidden />
  }
  const color = COLORS[status]
  // Pulse 'attention' so it actually grabs the user — it's the state that
  // needs them to do something, not the others.
  const animate = status === 'attention'
  return (
    <span
      title={LABELS[status]}
      aria-label={LABELS[status]}
      className={animate ? 'crucible-status-dot-pulse' : ''}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        display: 'inline-block',
        background: color,
        flexShrink: 0,
      }}
    />
  )
}
