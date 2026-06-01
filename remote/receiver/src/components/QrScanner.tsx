import { useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'

interface PairPayload {
  secret: string
  handle?: string
}

/**
 * Fullscreen camera-based QR scanner. Decodes a `…#pair=<base64url(JSON)>`
 * URL produced by the desktop popover and invokes `onPaired` with the parsed
 * payload. The host page is responsible for then calling pair / pairCloud.
 *
 * Camera access requires a secure context (HTTPS or localhost). Over a LAN
 * HTTP receiver, `getUserMedia` will reject — the user sees that error and
 * can fall back to typing or to scanning with the phone's native camera.
 */
export function QrScanner({
  onScanned,
  onClose,
}: {
  onScanned: (payload: PairPayload) => void
  onClose: () => void
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const rafRef = useRef<number | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  useEffect(() => {
    let cancelled = false
    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        await video.play()
        scan()
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.toLowerCase().includes('secure')) {
          setError('Camera needs HTTPS. Open the PWA via the cloud relay (not the LAN URL) to scan.')
        } else {
          setError(msg)
        }
      }
    }
    void start()
    return () => {
      cancelled = true
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      const s = streamRef.current
      if (s) s.getTracks().forEach((t) => t.stop())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const scan = () => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    if (video.readyState !== video.HAVE_ENOUGH_DATA) {
      rafRef.current = requestAnimationFrame(scan)
      return
    }
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })
    if (code) {
      const payload = parsePairUrl(code.data)
      if (payload) {
        onScanned(payload)
        return
      }
      // Unknown QR — keep scanning rather than error out, since random QRs
      // (URLs, wifi codes) the user might point at are common.
    }
    rafRef.current = requestAnimationFrame(scan)
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'black',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
        <video
          ref={videoRef}
          playsInline
          muted
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
        <canvas ref={canvasRef} style={{ display: 'none' }} />
        {/* viewfinder */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              width: 'min(70vw, 280px)',
              aspectRatio: '1 / 1',
              border: '2px solid white',
              borderRadius: 12,
              boxShadow: '0 0 0 9999px rgba(0,0,0,0.4)',
            }}
          />
        </div>
        {error && (
          <div
            style={{
              position: 'absolute',
              left: 16,
              right: 16,
              bottom: 80,
              padding: 12,
              background: 'rgba(220,38,38,0.95)',
              color: 'white',
              borderRadius: 8,
              fontSize: 13,
              lineHeight: 1.4,
            }}
          >
            {error}
          </div>
        )}
      </div>
      <div style={{ padding: 16, background: 'black', display: 'flex', justifyContent: 'center' }}>
        <button
          onClick={onClose}
          style={{
            padding: '12px 24px',
            background: 'white',
            color: 'black',
            border: 'none',
            borderRadius: 8,
            fontSize: 15,
            fontWeight: 600,
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function parsePairUrl(data: string): PairPayload | null {
  try {
    // Accept either a full URL with `#pair=…` or a raw `pair=…` fragment.
    let hash = ''
    if (data.includes('#')) hash = data.slice(data.indexOf('#') + 1)
    else hash = data.replace(/^#/, '')
    const params = new URLSearchParams(hash)
    const raw = params.get('pair')
    if (!raw) return null
    const b64 = raw.replace(/-/g, '+').replace(/_/g, '/')
    const json = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
    const parsed = JSON.parse(json) as { secret?: string; handle?: string }
    if (!parsed.secret) return null
    return { secret: parsed.secret, handle: parsed.handle }
  } catch {
    return null
  }
}
