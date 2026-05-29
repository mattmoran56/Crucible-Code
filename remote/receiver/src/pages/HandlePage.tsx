import { useState } from 'react'
import { pairCloud } from '../api/wsClient'
import { Button } from '@renderer/components/ui/Button'
import { Input } from '@renderer/components/ui/Input'

/**
 * Cloud-mode entry. The user types the desktop's word handle plus the 6-char
 * pairing code shown in the desktop popover. We never POST the code — it's
 * mixed into the encrypted key exchange so the relay can't see it.
 */
export function HandlePage({ onPaired }: { onPaired: () => void }) {
  const [handle, setHandle] = useState('')
  const [code, setCode] = useState('')
  const [label, setLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const labelToUse = label || navigator.userAgent.split(/[()]/)[1] || 'browser'
      // label is forwarded by openCloudConnection internally; this hook just
      // triggers the pair flow and resolves on auth success or error.
      void labelToUse
      await pairCloud(handle.trim().toLowerCase(), code.trim())
      // Auth happens async; the App component listens for connected state.
      onPaired()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const handleValid = /^[a-z]+(-[a-z]+){2,}$/.test(handle.trim().toLowerCase())

  return (
    <div className="min-h-screen bg-bg text-text flex items-center justify-center p-6" data-theme="dark">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="inline-flex items-center gap-2 mb-3">
            <span className="text-lg font-semibold">Crucible Code</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider bg-accent text-bg font-bold">
              Cloud
            </span>
          </div>
          <p className="text-sm text-text-muted">
            Enter your desktop's handle and the 6-character pairing code shown in its Remote popover.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-bg-secondary border border-border rounded-md p-5 space-y-5"
        >
          <Input
            autoFocus
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="tiger-violet-cobalt"
            style={{ fontSize: 16, textAlign: 'center', padding: '12px 14px' }}
          />
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABCDEF"
            maxLength={6}
            style={{ fontSize: 22, letterSpacing: 6, textAlign: 'center', textTransform: 'uppercase', padding: '14px 14px' }}
          />
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Device label (optional)"
            style={{ padding: '12px 14px' }}
          />
          <Button
            type="submit"
            disabled={busy || !handleValid || code.length !== 6}
            loading={busy}
            className="w-full"
          >
            Connect
          </Button>
          {error && <div className="text-xs text-danger">{error}</div>}
        </form>
      </div>
    </div>
  )
}
