import { useState } from 'react'
import { pair } from '../api/wsClient'

export function PairingPage({ onPaired }: { onPaired: () => void }) {
  const [code, setCode] = useState('')
  const [label, setLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const defaultLabel = label || navigator.userAgent.split(/[()]/)[1] || 'browser'
      await pair(code, defaultLabel)
      onPaired()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main style={{ maxWidth: 360, margin: '80px auto', fontFamily: 'system-ui' }}>
      <h1>Pair with Crucible Code</h1>
      <p style={{ color: '#555' }}>
        Enter the 6-character pairing code shown in the Remote popover on your desktop instance.
      </p>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <input
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="ABCDEF"
          maxLength={6}
          style={{
            fontSize: 22,
            letterSpacing: 4,
            padding: 10,
            textAlign: 'center',
            textTransform: 'uppercase',
          }}
        />
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Device label (optional)"
          style={{ padding: 8 }}
        />
        <button type="submit" disabled={busy || code.length !== 6}>
          {busy ? 'Pairing…' : 'Pair'}
        </button>
        {error && <div style={{ color: '#b91c1c' }}>{error}</div>}
      </form>
    </main>
  )
}
