import React from 'react'
import { useSettingsStore, type ThemeName } from '../../stores/settingsStore'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'

const THEMES: { name: ThemeName; label: string; colors: Record<string, string> }[] = [
  {
    name: 'dark',
    label: 'Tokyo Night',
    colors: {
      bg: '#1a1b26',
      'bg-secondary': '#24283b',
      'bg-tertiary': '#1f2335',
      border: '#3b4261',
      text: '#c0caf5',
      'text-muted': '#565f89',
      accent: '#7aa2f7',
      success: '#9ece6a',
      danger: '#f7768e',
      warning: '#e0af68',
    },
  },
  {
    name: 'light',
    label: 'Light',
    colors: {
      bg: '#f5f5f5',
      'bg-secondary': '#e8e8e8',
      'bg-tertiary': '#efefef',
      border: '#d0d0d0',
      text: '#1a1a2e',
      'text-muted': '#6b7280',
      accent: '#3b82f6',
      success: '#22c55e',
      danger: '#ef4444',
      warning: '#f59e0b',
    },
  },
  {
    name: 'soft-light',
    label: 'Soft Light',
    colors: {
      bg: '#faf6f1',
      'bg-secondary': '#f0ebe4',
      'bg-tertiary': '#f5f0ea',
      border: '#ddd5ca',
      text: '#3d3229',
      'text-muted': '#8c7e72',
      accent: '#7c6f9b',
      success: '#6a9e6b',
      danger: '#c46a6a',
      warning: '#c4976a',
    },
  },
  {
    name: 'ultra-dark',
    label: 'Ultra Dark',
    colors: {
      bg: '#0d0d0d',
      'bg-secondary': '#141414',
      'bg-tertiary': '#111111',
      border: '#252525',
      text: '#d4d4d4',
      'text-muted': '#525252',
      accent: '#6d9efd',
      success: '#4ade80',
      danger: '#fb7185',
      warning: '#fbbf24',
    },
  },
]

export function SettingsPage() {
  const { theme, setTheme, closeSettings } = useSettingsStore()

  return (
    <div className="h-full flex flex-col bg-bg">
      {/* Header */}
      <div
        className="titlebar-drag flex items-center h-11 bg-bg-tertiary border-b border-border"
      >
        <div className="w-[78px] shrink-0" />
        <IconButton
          label="Back"
          tooltipSide="bottom"
          onClick={closeSettings}
          className="titlebar-no-drag"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </IconButton>
        <span className="text-sm font-medium text-text ml-2">Settings</span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto" style={{ padding: '24px 32px' }}>
        <div style={{ maxWidth: 640 }}>
          <h1 className="text-lg font-semibold text-text" style={{ marginBottom: 4 }}>Appearance</h1>
          <p className="text-xs text-text-muted" style={{ marginBottom: 20 }}>
            Choose a theme for the interface.
          </p>

          <div className="flex gap-4 flex-wrap">
            {THEMES.map((t) => {
              const isActive = theme === t.name
              return (
                <Button
                  key={t.name}
                  variant="ghost"
                  onClick={() => setTheme(t.name)}
                  className={`
                    rounded-lg border-2 text-left
                    ${isActive ? 'border-accent' : 'border-border hover:border-text-muted'}
                  `}
                  style={{ width: 180, padding: 0, background: 'none' }}
                >
                  {/* Preview */}
                  <div
                    className="rounded-t-md"
                    style={{
                      background: t.colors.bg,
                      padding: '10px 12px',
                      borderBottom: `1px solid ${t.colors.border}`,
                    }}
                  >
                    {/* Mini sidebar + content mockup */}
                    <div style={{ display: 'flex', gap: 6, height: 48 }}>
                      <div
                        style={{
                          width: 40,
                          background: t.colors['bg-secondary'],
                          borderRadius: 3,
                          border: `1px solid ${t.colors.border}`,
                        }}
                      />
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div
                          style={{
                            height: 6,
                            width: '70%',
                            background: t.colors.text,
                            borderRadius: 2,
                            opacity: 0.6,
                          }}
                        />
                        <div
                          style={{
                            height: 6,
                            width: '50%',
                            background: t.colors['text-muted'],
                            borderRadius: 2,
                            opacity: 0.6,
                          }}
                        />
                        <div style={{ flex: 1 }} />
                        <div style={{ display: 'flex', gap: 3 }}>
                          <div style={{ width: 8, height: 8, borderRadius: 2, background: t.colors.accent }} />
                          <div style={{ width: 8, height: 8, borderRadius: 2, background: t.colors.success }} />
                          <div style={{ width: 8, height: 8, borderRadius: 2, background: t.colors.danger }} />
                          <div style={{ width: 8, height: 8, borderRadius: 2, background: t.colors.warning }} />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Label */}
                  <div
                    className="rounded-b-md"
                    style={{
                      padding: '8px 12px',
                      background: t.colors['bg-secondary'],
                    }}
                  >
                    <span style={{ fontSize: 12, fontWeight: 500, color: t.colors.text }}>
                      {t.label}
                    </span>
                  </div>
                </Button>
              )
            })}
          </div>

          {/* Color palette detail for active theme */}
          <div style={{ marginTop: 24 }}>
            <h2 className="text-xs font-medium text-text-muted uppercase tracking-wide" style={{ marginBottom: 10 }}>
              Palette — {THEMES.find((t) => t.name === theme)?.label}
            </h2>
            <div className="flex flex-wrap gap-2">
              {Object.entries(THEMES.find((t) => t.name === theme)?.colors ?? {}).map(
                ([token, hex]) => (
                  <div
                    key={token}
                    className="flex items-center gap-2 border border-border rounded"
                    style={{ padding: '4px 8px' }}
                  >
                    <div
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: 3,
                        background: hex,
                        border: '1px solid var(--color-border)',
                      }}
                    />
                    <span className="text-[11px] text-text-muted">{token}</span>
                    <span className="text-[10px] text-text-muted" style={{ opacity: 0.6 }}>
                      {hex}
                    </span>
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
