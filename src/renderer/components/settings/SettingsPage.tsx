import React, { useEffect } from 'react'
import { useSettingsStore } from '../../stores/settingsStore'
import { THEMES, type ThemeName, type ClaudeTheme } from '../../../shared/themes'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import { ToggleGroup } from '../ui/ToggleGroup'

const LIGHT_THEMES = THEMES.filter((t) => !t.isDark)
const DARK_THEMES = THEMES.filter((t) => t.isDark)

export function SettingsPage() {
  const {
    theme, setTheme, closeSettings,
    matchSystem, setMatchSystem,
    preferredLight, setPreferredLight,
    preferredDark, setPreferredDark,
    claudeTheme, setClaudeTheme,
  } = useSettingsStore()

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSettings()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [closeSettings])

  const activeTheme = THEMES.find((t) => t.name === theme)

  return (
    <div className="h-full flex flex-col bg-bg">
      {/* Header */}
      <div
        className="titlebar-drag flex items-center h-11 bg-bg-tertiary border-b border-border"
      >
        {/* Spacer for macOS traffic lights (close/minimize/maximize) */}
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

          {/* Match system toggle */}
          <div
            className="flex items-center justify-between border border-border rounded-md"
            style={{ padding: '10px 14px', marginBottom: 20 }}
          >
            <div>
              <p className="text-xs font-medium text-text">Match System</p>
              <p className="text-[11px] text-text-muted">
                Automatically switch between light and dark with your OS
              </p>
            </div>
            <ToggleGroup
              options={[
                { value: 'off', label: 'Off' },
                { value: 'on', label: 'On' },
              ]}
              value={matchSystem ? 'on' : 'off'}
              onChange={(v) => setMatchSystem(v === 'on')}
            />
          </div>

          {/* Preferred light/dark selectors — shown when match system is on */}
          {matchSystem && (
            <div className="flex gap-4" style={{ marginBottom: 20 }}>
              <div className="flex-1 border border-border rounded-md" style={{ padding: '10px 14px' }}>
                <p className="text-[11px] font-medium text-text-muted uppercase tracking-wide" style={{ marginBottom: 8 }}>
                  Light theme
                </p>
                <div className="flex gap-2">
                  {LIGHT_THEMES.map((t) => (
                    <Button
                      key={t.name}
                      variant="ghost"
                      size="sm"
                      onClick={() => setPreferredLight(t.name)}
                      className={`border ${preferredLight === t.name ? 'border-accent text-text' : 'border-border'}`}
                      style={{ padding: '4px 10px' }}
                    >
                      <span className="flex items-center gap-2">
                        <span
                          style={{
                            width: 10, height: 10, borderRadius: 2,
                            background: t.colors.bg,
                            border: `1px solid ${t.colors.border}`,
                          }}
                        />
                        {t.label}
                      </span>
                    </Button>
                  ))}
                </div>
              </div>
              <div className="flex-1 border border-border rounded-md" style={{ padding: '10px 14px' }}>
                <p className="text-[11px] font-medium text-text-muted uppercase tracking-wide" style={{ marginBottom: 8 }}>
                  Dark theme
                </p>
                <div className="flex gap-2">
                  {DARK_THEMES.map((t) => (
                    <Button
                      key={t.name}
                      variant="ghost"
                      size="sm"
                      onClick={() => setPreferredDark(t.name)}
                      className={`border ${preferredDark === t.name ? 'border-accent text-text' : 'border-border'}`}
                      style={{ padding: '4px 10px' }}
                    >
                      <span className="flex items-center gap-2">
                        <span
                          style={{
                            width: 10, height: 10, borderRadius: 2,
                            background: t.colors.bg,
                            border: `1px solid ${t.colors.border}`,
                          }}
                        />
                        {t.label}
                      </span>
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Theme cards */}
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

          {/* Claude Code theme */}
          <div
            className="flex items-center justify-between border border-border rounded-md"
            style={{ padding: '10px 14px', marginTop: 24 }}
          >
            <div>
              <p className="text-xs font-medium text-text">Claude Code Theme</p>
              <p className="text-[11px] text-text-muted">
                Theme used for Claude Code sessions
              </p>
            </div>
            <ToggleGroup
              options={[
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
              ]}
              value={claudeTheme}
              onChange={(v) => setClaudeTheme(v as ClaudeTheme)}
            />
          </div>

          {/* Color palette detail for active theme */}
          <div style={{ marginTop: 24 }}>
            <h2 className="text-xs font-medium text-text-muted uppercase tracking-wide" style={{ marginBottom: 10 }}>
              Palette — {activeTheme?.label}
            </h2>
            <div className="flex flex-wrap gap-2">
              {Object.entries(activeTheme?.colors ?? {}).map(
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
