import { useEffect, useRef, useState } from 'react'

interface RemoteStatus {
  enabled: boolean
  running: boolean
  port: number
  urls: string[]
  pairingCode: string | null
  devices: { token: string; label: string; createdAt: number }[]
}

export function RemoteTogglePopover() {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<RemoteStatus | null>(null)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    window.api.remote.getStatus().then(setStatus)
    const off = window.api.remote.onStatusChanged(setStatus)
    return () => {
      off()
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const handleToggle = async () => {
    if (!status) return
    const next = await window.api.remote.setEnabled(!status.enabled)
    setStatus(next)
  }

  const handleRegenerate = async () => {
    setStatus(await window.api.remote.regenerateCode())
  }

  const handleRevokeAll = async () => {
    setStatus(await window.api.remote.revokeAll())
  }

  const dotColor = status?.running ? '#22c55e' : '#9ca3af'

  return (
    <div ref={ref} className="titlebar-no-drag" style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Remote connection"
        className="titlebar-no-drag"
        style={{
          background: 'transparent',
          border: '1px solid rgba(0,0,0,0.1)',
          borderRadius: 6,
          padding: '4px 10px',
          fontSize: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          cursor: 'pointer',
        }}
      >
        <span
          style={{
            display: 'inline-block',
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: dotColor,
          }}
        />
        Remote
      </button>
      {open && status && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 6,
            width: 320,
            background: 'white',
            color: '#111',
            border: '1px solid rgba(0,0,0,0.15)',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            padding: 14,
            zIndex: 9999,
            fontSize: 13,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>Remote access</strong>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={status.enabled} onChange={handleToggle} />
              {status.enabled ? 'On' : 'Off'}
            </label>
          </div>
          {status.running ? (
            <>
              <div style={{ marginTop: 10, color: '#555' }}>Open on another device:</div>
              <ul style={{ paddingLeft: 18, margin: '4px 0' }}>
                {status.urls.length === 0 && <li>(no LAN address)</li>}
                {status.urls.map((u) => (
                  <li key={u}>
                    <code>{u}</code>
                  </li>
                ))}
              </ul>
              <div style={{ marginTop: 10, color: '#555' }}>Pairing code:</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <code
                  style={{
                    fontSize: 18,
                    letterSpacing: 2,
                    padding: '4px 10px',
                    background: '#f3f4f6',
                    borderRadius: 4,
                  }}
                >
                  {status.pairingCode ?? '——————'}
                </code>
                <button type="button" onClick={handleRegenerate} style={{ fontSize: 12 }}>
                  Regenerate
                </button>
              </div>
              <div style={{ marginTop: 12, color: '#555' }}>
                Paired devices: {status.devices.length}
              </div>
              {status.devices.length > 0 && (
                <ul style={{ paddingLeft: 18, margin: '4px 0' }}>
                  {status.devices.map((d) => (
                    <li key={d.token}>
                      {d.label} <span style={{ color: '#888' }}>({d.token})</span>
                    </li>
                  ))}
                </ul>
              )}
              {status.devices.length > 0 && (
                <button type="button" onClick={handleRevokeAll} style={{ fontSize: 12, marginTop: 6 }}>
                  Revoke all
                </button>
              )}
            </>
          ) : (
            <p style={{ color: '#555', marginTop: 10 }}>
              Toggle on to allow another device on your network to view and control this Crucible
              Code instance.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
