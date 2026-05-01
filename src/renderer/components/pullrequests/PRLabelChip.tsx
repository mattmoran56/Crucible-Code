import React from 'react'
import type { PRLabel } from '../../../shared/types'

function readableTextColor(hex: string): string {
  const cleaned = hex.replace(/^#/, '')
  const full = cleaned.length === 3
    ? cleaned.split('').map((c) => c + c).join('')
    : cleaned
  if (full.length !== 6) return '#000000'
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  // Relative luminance — sRGB coefficients
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.55 ? '#000000' : '#ffffff'
}

interface Props {
  label: PRLabel
}

export function PRLabelChip({ label }: Props) {
  const bg = `#${label.color || '888888'}`
  const fg = readableTextColor(label.color || '888888')
  return (
    <span
      className="inline-flex items-center rounded-full text-[10px] font-medium leading-none whitespace-nowrap max-w-[140px]"
      style={{
        background: bg,
        color: fg,
        padding: '3px 8px',
      }}
      title={label.description ? `${label.name} — ${label.description}` : label.name}
    >
      <span className="truncate">{label.name}</span>
    </span>
  )
}
