import React from 'react'

interface IconProps {
  size?: number
  className?: string
}

const base = (size: number, className?: string) => ({
  width: size,
  height: size,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className,
  'aria-hidden': true,
})

export const ChevronRight = ({ size = 12, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M6 4l4 4-4 4" />
  </svg>
)

export const ChevronLeft = ({ size = 12, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M10 4L6 8l4 4" />
  </svg>
)

export const ChevronUp = ({ size = 12, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M4 10l4-4 4 4" />
  </svg>
)

export const Close = ({ size = 12, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
)

export const Sparkle = ({ size = 12, className }: IconProps) => (
  <svg {...base(size, className)} fill="currentColor" stroke="none">
    <path d="M8 1.5l1.4 4.1 4.1 1.4-4.1 1.4L8 12.5 6.6 8.4 2.5 7l4.1-1.4z" />
  </svg>
)

export const StopSquare = ({ size = 12, className }: IconProps) => (
  <svg {...base(size, className)} fill="currentColor" stroke="none">
    <rect x="4" y="4" width="8" height="8" rx="1.5" />
  </svg>
)

export const SendArrow = ({ size = 12, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" />
  </svg>
)

export const Fold = ({ size = 12, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M3 4h10M3 8h7M3 12h4" />
  </svg>
)

export const Wrench = ({ size = 12, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M10.5 2.5a3 3 0 00-3.8 3.8L2.5 10.5l3 3 4.2-4.2a3 3 0 003.8-3.8l-1.8 1.8-1.8-.4-.4-1.8z" />
  </svg>
)

export const Restart = ({ size = 12, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M13 8a5 5 0 11-1.5-3.5M13 2.5v3h-3" />
  </svg>
)

export const Power = ({ size = 12, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M8 2v5M4.8 4.2a5 5 0 106.4 0" />
  </svg>
)

export const Check = ({ size = 12, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M3.5 8.5l3 3 6-7" />
  </svg>
)

export const Branch = ({ size = 12, className }: IconProps) => (
  <svg {...base(size, className)}>
    <circle cx="4.5" cy="3.5" r="1.5" />
    <circle cx="4.5" cy="12.5" r="1.5" />
    <circle cx="11.5" cy="5.5" r="1.5" />
    <path d="M4.5 5v6M11.5 7c0 2.5-3 2.5-6 4" />
  </svg>
)

export const Plus = ({ size = 12, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M8 3v10M3 8h10" />
  </svg>
)

export const Mic = ({ size = 12, className }: IconProps) => (
  <svg {...base(size, className)}>
    <rect x="6" y="2" width="4" height="7.5" rx="2" />
    <path d="M3.75 7.5a4.25 4.25 0 008.5 0M8 11.75V14" />
  </svg>
)

export const FileIcon =({ size = 12, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M9 2H4.5A1.5 1.5 0 003 3.5v9A1.5 1.5 0 004.5 14h7a1.5 1.5 0 001.5-1.5V6L9 2z" />
    <path d="M9 2v4h4" />
  </svg>
)

export const ImageIcon = ({ size = 12, className }: IconProps) => (
  <svg {...base(size, className)}>
    <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
    <circle cx="6" cy="6.5" r="1" />
    <path d="M13.5 10.5L10.5 7.5 4 13" />
  </svg>
)

/** A small spinner sized by font. Respects reduced motion via Tailwind's motion-reduce. */
export const Spinner = ({ className }: { className?: string }) => (
  <span
    aria-hidden="true"
    className={`inline-block size-3 shrink-0 animate-spin rounded-full border-[1.5px] border-current border-t-transparent motion-reduce:animate-none ${className ?? ''}`}
  />
)
