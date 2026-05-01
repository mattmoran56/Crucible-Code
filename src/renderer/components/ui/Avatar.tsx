import React from 'react'

interface Props {
  login: string
  size?: number
  title?: string
  ringClassName?: string
}

export function Avatar({ login, size = 20, title, ringClassName }: Props) {
  const initials = login.slice(0, 2).toUpperCase()
  const fontSize = Math.max(8, Math.round(size * 0.5))
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full bg-bg-tertiary text-text font-semibold ${ringClassName ?? ''}`}
      style={{ width: size, height: size, fontSize }}
      title={title ?? login}
    >
      {initials}
    </span>
  )
}
