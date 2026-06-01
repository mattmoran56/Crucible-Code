import { useState } from 'react'
import { pair } from '../api/wsClient'
import { Button } from '@renderer/components/ui/Button'
import { Input } from '@renderer/components/ui/Input'

export function PairingPage({
  onPaired,
  initialError = null,
}: {
  onPaired: () => void
  initialError?: string | null
}) {
  const [code, setCode] = useState('')
  const [label, setLabel] = useState('')
  const [error, setError] = useState<string | null>(initialError)
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
    <div className="min-h-screen bg-bg text-text flex items-center justify-center p-6" data-theme="dark">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="inline-flex items-center gap-2 mb-3">
            <span className="text-lg font-semibold">Crucible Code</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider bg-accent text-bg font-bold">
              Remote
            </span>
          </div>
          <p className="text-sm text-text-muted">
            Enter the 6-character pairing code shown in the Remote popover on your desktop.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-bg-secondary border border-border rounded-md p-4 space-y-3"
        >
          <Input
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABCDEF"
            style={{ fontSize: 22, letterSpacing: 6, textAlign: 'center', textTransform: 'uppercase' }}
          />
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Device label (optional)"
          />
          <Button
            type="submit"
            disabled={busy || code.length < 6}
            loading={busy}
            className="w-full"
          >
            Pair
          </Button>
          {error && <div className="text-xs text-danger">{error}</div>}
        </form>
      </div>
    </div>
  )
}
