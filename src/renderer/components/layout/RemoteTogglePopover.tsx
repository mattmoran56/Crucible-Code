import { useEffect, useRef, useState } from 'react'

interface PendingPairing {
  id: string
  label: string
  mode: 'lan' | 'cloud'
  code: string | null
  createdAt: number
}

interface RemoteStatus {
  enabled: boolean
  running: boolean
  port: number
  urls: string[]
  pairingCode: string | null
  devices: { token: string; label: string; createdAt: number }[]
  cloud: {
    enabled: boolean
    handle: string | null
    ticket: string | null
    connected: boolean
    safetyNumber: string | null
  }
  requireApproval: boolean
  pendingPairings: PendingPairing[]
}

export function RemoteTogglePopover() {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<RemoteStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement | null>(null)

  // The mock app + Storybook don't expose the remote namespace on window.api;
  // skip rendering rather than crashing the project tabs row.
  const remoteApi = (window.api as { remote?: unknown }).remote as
    | {
        getStatus: () => Promise<RemoteStatus>
        setEnabled: (enabled: boolean) => Promise<RemoteStatus>
        regenerateCode: () => Promise<RemoteStatus>
        revokeAll: () => Promise<RemoteStatus>
        onStatusChanged: (cb: (s: RemoteStatus) => void) => () => void
        setCloudEnabled: (enabled: boolean) => Promise<RemoteStatus>
        regenerateHandle: () => Promise<RemoteStatus>
        setRequireApproval: (enabled: boolean) => Promise<RemoteStatus>
        approvePairing: (id: string) => Promise<RemoteStatus>
        denyPairing: (id: string) => Promise<RemoteStatus>
        onPairingRequested: (cb: (pending: PendingPairing[]) => void) => () => void
      }
    | undefined

  useEffect(() => {
    if (!remoteApi) return
    remoteApi.getStatus().then(setStatus)
    const off = remoteApi.onStatusChanged(setStatus)
    // Auto-open the popover when a pairing request needs attention.
    const offReq = remoteApi.onPairingRequested((pending) => {
      if (pending.length > 0) setOpen(true)
    })
    return () => {
      off()
      offReq()
    }
  }, [remoteApi])

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
    const next = await remoteApi!.setEnabled(!status.enabled)
    setStatus(next)
  }

  const handleRegenerate = async () => {
    setStatus(await remoteApi!.regenerateCode())
  }

  const handleRevokeAll = async () => {
    setStatus(await remoteApi!.revokeAll())
  }

  const handleToggleCloud = async () => {
    if (!status) return
    setError(null)
    try {
      setStatus(await remoteApi!.setCloudEnabled(!status.cloud.enabled))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // Strip the noisy IPC prefix Electron prepends.
      setError(msg.replace(/^Error invoking remote method '[^']+':\s*Error:\s*/, ''))
    }
  }

  const handleRegenerateHandle = async () => {
    setError(null)
    try {
      setStatus(await remoteApi!.regenerateHandle())
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg.replace(/^Error invoking remote method '[^']+':\s*Error:\s*/, ''))
    }
  }

  const handleCopyHandle = async () => {
    if (status?.cloud.handle) await navigator.clipboard.writeText(status.cloud.handle)
  }

  const handleToggleRequireApproval = async () => {
    if (!status) return
    setStatus(await remoteApi!.setRequireApproval(!status.requireApproval))
  }

  const handleApprove = async (id: string) => {
    setStatus(await remoteApi!.approvePairing(id))
  }

  const handleDeny = async (id: string) => {
    setStatus(await remoteApi!.denyPairing(id))
  }

  if (!remoteApi) return null

  const dotColor = status?.running || status?.cloud.connected ? '#22c55e' : '#9ca3af'

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

          {/* Pending pairing approval prompts — appear when requireApproval is
              on and a phone tries to pair. Shown at the top so they're hard to
              miss. */}
          {status.pendingPairings.length > 0 && (
            <div style={{ marginTop: 10 }}>
              {status.pendingPairings.map((p) => (
                <div
                  key={p.id}
                  style={{
                    border: '1px solid #fcd34d',
                    background: '#fffbeb',
                    borderRadius: 6,
                    padding: 10,
                    marginBottom: 8,
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>
                    Allow <code>{p.label}</code> to pair?
                  </div>
                  <div style={{ fontSize: 11, color: '#78716c', marginBottom: 6 }}>
                    {p.mode === 'lan' ? 'LAN' : 'Cloud'} request. Code shown on phone:
                  </div>
                  <div
                    style={{
                      fontFamily: 'monospace',
                      fontSize: 16,
                      letterSpacing: 2,
                      background: '#fef3c7',
                      padding: '4px 8px',
                      borderRadius: 4,
                      display: 'inline-block',
                      marginBottom: 8,
                    }}
                  >
                    {p.code ?? '—'}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => handleApprove(p.id)}
                      style={{
                        background: '#16a34a',
                        color: 'white',
                        border: 'none',
                        borderRadius: 4,
                        padding: '4px 12px',
                        fontSize: 12,
                        cursor: 'pointer',
                      }}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeny(p.id)}
                      style={{
                        background: '#dc2626',
                        color: 'white',
                        border: 'none',
                        borderRadius: 4,
                        padding: '4px 12px',
                        fontSize: 12,
                        cursor: 'pointer',
                      }}
                    >
                      Deny
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Shared toggle: applies to both LAN and Cloud pairing paths. */}
          <div
            style={{
              marginTop: 10,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '6px 0',
              borderBottom: '1px dashed rgba(0,0,0,0.08)',
            }}
          >
            <span style={{ color: '#555' }} title="When on, you must approve each new pairing from this popover before a token is issued.">
              Require approval to connect
            </span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={status.requireApproval}
                onChange={handleToggleRequireApproval}
              />
              {status.requireApproval ? 'On' : 'Off'}
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

          <div style={{ borderTop: '1px solid rgba(0,0,0,0.1)', marginTop: 14, paddingTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong>Cloud relay</strong>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={status.cloud.enabled}
                  onChange={handleToggleCloud}
                />
                {status.cloud.enabled ? 'On' : 'Off'}
              </label>
            </div>
            {status.cloud.enabled ? (
              <>
                <div style={{ marginTop: 8, color: '#555' }}>Handle:</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <code
                    onClick={handleCopyHandle}
                    style={{
                      fontSize: 14,
                      padding: '4px 10px',
                      background: '#f3f4f6',
                      borderRadius: 4,
                      cursor: 'pointer',
                      flex: 1,
                    }}
                    title="Click to copy"
                  >
                    {status.cloud.handle ?? '—'}
                  </code>
                  <button type="button" onClick={handleRegenerateHandle} style={{ fontSize: 12 }}>
                    Regenerate
                  </button>
                </div>
                <div style={{ marginTop: 10, color: '#555' }}>Pairing code:</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
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
                <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, color: '#555' }}>
                  <span
                    style={{
                      display: 'inline-block',
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: status.cloud.connected ? '#22c55e' : '#9ca3af',
                    }}
                  />
                  {status.cloud.connected ? 'Connected to relay' : 'Disconnected'}
                </div>
                {status.cloud.safetyNumber && (
                  <div style={{ marginTop: 8, color: '#555' }}>
                    Safety number:&nbsp;
                    <code style={{ fontSize: 13, letterSpacing: 1 }}>
                      {status.cloud.safetyNumber}
                    </code>
                    <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                      Compare with your phone — they must match.
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p style={{ color: '#555', marginTop: 8, fontSize: 12 }}>
                Reach this desktop from anywhere through a hosted relay. Use this when LAN pairing
                doesn't work (e.g. on a VPN).
              </p>
            )}
            {error && (
              <div
                style={{
                  marginTop: 10,
                  padding: '6px 8px',
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: 4,
                  color: '#991b1b',
                  fontSize: 11,
                  wordBreak: 'break-word',
                }}
              >
                {error}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
