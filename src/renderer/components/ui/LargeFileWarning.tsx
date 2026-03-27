import React from 'react'
import { Button } from './Button'

interface LargeFileWarningProps {
  fileName: string
  fileSize: number
  onOpen: () => void
  onCancel: () => void
}

/**
 * Inline warning shown when a file exceeds the size threshold.
 * Used in diff viewers and the code editor.
 */
export function LargeFileWarning({ fileName, fileSize, onOpen, onCancel }: LargeFileWarningProps) {
  const sizeMB = (fileSize / 1024 / 1024).toFixed(1)

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-center" style={{ maxWidth: 320 }}>
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-warning">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <div>
          <p className="text-text text-xs font-medium mb-1">Large file</p>
          <p className="text-text-muted text-xs">
            <strong className="text-text">{fileName}</strong> is {sizeMB}MB.
            Opening it may slow down the editor.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={onOpen}>
            Open Anyway
          </Button>
        </div>
      </div>
    </div>
  )
}
