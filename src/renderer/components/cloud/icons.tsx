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

export const CloudIcon = ({ size = 12, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M4.5 12.5h7a3 3 0 0 0 .4-5.97A4 4 0 0 0 4.2 7.6 2.5 2.5 0 0 0 4.5 12.5z" />
  </svg>
)

/** A cloud with an arrow coming down out of it. */
export const TeleportIcon = ({ size = 12, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M5 10.5H4.4a2.4 2.4 0 0 1-.3-4.78A3.6 3.6 0 0 1 11 5.1a2.7 2.7 0 0 1 .9 5.4H11" />
    <path d="M8 7.5v7M5.8 12.3 8 14.5l2.2-2.2" />
  </svg>
)

export const ExternalIcon = ({ size = 12, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M9 3h4v4M13 3 7.5 8.5M11.5 9.5V13H3V4.5h3.5" />
  </svg>
)
