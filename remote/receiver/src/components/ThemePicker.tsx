import { useEffect, useState } from 'react'

const THEMES = [
  { id: 'dark', label: 'Tokyo Night' },
  { id: 'ultra-dark', label: 'Ultra Dark' },
  { id: 'light', label: 'Light' },
  { id: 'soft-light', label: 'Soft Light' },
] as const

type ThemeId = (typeof THEMES)[number]['id']

const STORAGE_KEY = 'codecrucible-remote-theme'

function loadTheme(): ThemeId {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored && THEMES.some((t) => t.id === stored)) return stored as ThemeId
  return 'dark'
}

export function applyStoredTheme(): void {
  document.documentElement.setAttribute('data-theme', loadTheme())
}

export function ThemePicker() {
  const [theme, setTheme] = useState<ThemeId>(loadTheme())
  const [open, setOpen] = useState(false)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem(STORAGE_KEY, theme)
  }, [theme])

  useEffect(() => {
    if (!open) return
    const onClick = () => setOpen(false)
    // Fire after the toggling click finishes
    const t = setTimeout(() => document.addEventListener('click', onClick), 0)
    return () => {
      clearTimeout(t)
      document.removeEventListener('click', onClick)
    }
  }, [open])

  const current = THEMES.find((t) => t.id === theme)

  return (
    <div className="relative">
      <button
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        title="Theme (web only — independent from desktop)"
        className="text-xs text-text-muted hover:text-text flex items-center gap-1.5"
        style={{ padding: '4px 8px' }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
          <path d="M2 12h20" />
        </svg>
        {current?.label}
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-50 bg-bg-secondary border border-border rounded shadow-lg min-w-[140px]"
          onClick={(e) => e.stopPropagation()}
        >
          {THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setTheme(t.id)
                setOpen(false)
              }}
              className={
                'block w-full text-left text-xs transition-colors ' +
                (t.id === theme ? 'text-accent bg-bg' : 'text-text hover:bg-bg-tertiary')
              }
              style={{ padding: '6px 10px' }}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
