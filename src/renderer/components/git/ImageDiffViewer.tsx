import React, { useEffect, useState } from 'react'
import { ToggleGroup } from '../ui/ToggleGroup'

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.ico', '.avif',
])

export function isImageFile(filePath: string): boolean {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
  return IMAGE_EXTENSIONS.has(ext)
}

function getMimeType(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
  const map: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.avif': 'image/avif',
  }
  return map[ext] || 'image/png'
}

type ImageViewMode = 'side-by-side' | 'overlay'

interface ImageDiffViewerProps {
  repoPath: string
  filePath: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  /** Git ref for "before" image (e.g. "abc123~1", "main"). Not needed for added files. */
  beforeRef?: string
  /** Git ref for "after" image (e.g. "abc123"). Null means read from working tree. */
  afterRef?: string | null
}

export function ImageDiffViewer({ repoPath, filePath, status, beforeRef, afterRef }: ImageDiffViewerProps) {
  const [beforeSrc, setBeforeSrc] = useState<string | null>(null)
  const [afterSrc, setAfterSrc] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<ImageViewMode>('side-by-side')
  const [overlayOpacity, setOverlayOpacity] = useState(50)

  const mime = getMimeType(filePath)
  const showBefore = status === 'modified' || status === 'deleted' || status === 'renamed'
  const showAfter = status === 'modified' || status === 'added' || status === 'renamed'

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setBeforeSrc(null)
    setAfterSrc(null)

    const load = async () => {
      const promises: Promise<void>[] = []

      if (showBefore && beforeRef) {
        promises.push(
          window.api.git.showFileBase64(repoPath, beforeRef, filePath).then((data) => {
            if (!cancelled && data) setBeforeSrc(`data:${mime};base64,${data}`)
          })
        )
      }

      if (showAfter) {
        if (afterRef) {
          promises.push(
            window.api.git.showFileBase64(repoPath, afterRef, filePath).then((data) => {
              if (!cancelled && data) setAfterSrc(`data:${mime};base64,${data}`)
            })
          )
        } else {
          // Read from working tree
          const fullPath = repoPath + '/' + filePath
          promises.push(
            window.api.file.readBase64(fullPath, repoPath).then((data) => {
              if (!cancelled && data) setAfterSrc(`data:${mime};base64,${data}`)
            }).catch(() => {})
          )
        }
      }

      await Promise.all(promises)
      if (!cancelled) setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [repoPath, filePath, status, beforeRef, afterRef, mime, showBefore, showAfter])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-xs" style={{ padding: '24px' }}>
        Loading image...
      </div>
    )
  }

  if (!beforeSrc && !afterSrc) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-xs" style={{ padding: '24px' }}>
        Unable to load image preview
      </div>
    )
  }

  // Single image (added or deleted)
  if (!showBefore || !showAfter) {
    return (
      <div className="flex-1 flex flex-col items-center overflow-auto" style={{ padding: '16px' }}>
        <div className="text-xs text-text-muted mb-3">
          {status === 'added' ? 'Added' : 'Deleted'}
        </div>
        <ImagePanel
          src={(showAfter ? afterSrc : beforeSrc)!}
          label={status === 'added' ? 'New' : 'Removed'}
          borderColor={status === 'added' ? 'var(--color-success)' : 'var(--color-danger)'}
        />
      </div>
    )
  }

  // Modified — show comparison
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center justify-center gap-3 bg-bg-tertiary border-b border-border" style={{ padding: '6px 12px' }}>
        <ToggleGroup
          options={[
            { value: 'side-by-side' as ImageViewMode, label: 'Side by Side' },
            { value: 'overlay' as ImageViewMode, label: 'Overlay' },
          ]}
          value={viewMode}
          onChange={setViewMode}
        />
      </div>

      {viewMode === 'side-by-side' ? (
        <div className="flex-1 flex gap-4 overflow-auto" style={{ padding: '16px' }}>
          <div className="flex-1 flex flex-col items-center min-w-0">
            <span className="text-xs text-danger mb-2">Before</span>
            {beforeSrc ? (
              <ImagePanel src={beforeSrc} label="Before" borderColor="var(--color-danger)" />
            ) : (
              <div className="text-xs text-text-muted">Not available</div>
            )}
          </div>
          <div className="flex-1 flex flex-col items-center min-w-0">
            <span className="text-xs text-success mb-2">After</span>
            {afterSrc ? (
              <ImagePanel src={afterSrc} label="After" borderColor="var(--color-success)" />
            ) : (
              <div className="text-xs text-text-muted">Not available</div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center overflow-auto" style={{ padding: '16px' }}>
          <div className="flex items-center gap-3 mb-3">
            <span className="text-xs text-danger">Before</span>
            <input
              type="range"
              min={0}
              max={100}
              value={overlayOpacity}
              onChange={(e) => setOverlayOpacity(Number(e.target.value))}
              className="w-32 accent-accent"
              aria-label="Overlay opacity"
            />
            <span className="text-xs text-success">After</span>
          </div>
          <div className="relative inline-block">
            {beforeSrc && (
              <img
                src={beforeSrc}
                alt="Before"
                className="max-w-full"
                style={{ maxHeight: '60vh', border: '1px solid var(--color-danger)' }}
                draggable={false}
              />
            )}
            {afterSrc && (
              <img
                src={afterSrc}
                alt="After"
                className="max-w-full absolute top-0 left-0"
                style={{
                  maxHeight: '60vh',
                  opacity: overlayOpacity / 100,
                  border: '1px solid var(--color-success)',
                }}
                draggable={false}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function ImagePanel({ src, label, borderColor }: { src: string; label: string; borderColor: string }) {
  return (
    <div className="inline-flex flex-col items-center">
      <img
        src={src}
        alt={label}
        className="max-w-full"
        style={{ maxHeight: '60vh', border: `1px solid ${borderColor}`, borderRadius: '2px' }}
        draggable={false}
      />
    </div>
  )
}
