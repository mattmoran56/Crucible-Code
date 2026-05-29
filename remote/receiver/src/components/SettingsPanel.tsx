import { useEffect, useState } from 'react'
import { api, wsClient } from '../api/wsClient'
import { ThemeRadioList } from './ThemePicker'

interface NotionConfig {
  enabled?: boolean
  [k: string]: unknown
}

export function SettingsPanel({ projectId }: { projectId: string }) {
  const [notion, setNotion] = useState<NotionConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [safetyNumber, setSafetyNumber] = useState<string | null>(null)

  useEffect(() => {
    api.notion
      .loadConfig(projectId)
      .then((c) => setNotion((c as NotionConfig | null) ?? { enabled: false }))
      .catch((e) => setError(String(e)))
  }, [projectId])

  useEffect(() => wsClient.onSafetyNumber(setSafetyNumber), [])

  const handleNotionToggle = async () => {
    if (!notion) return
    const next = { ...notion, enabled: !notion.enabled }
    setNotion(next)
    try {
      await api.notion.saveConfig(projectId, next)
    } catch (e) {
      setError(String(e))
      setNotion(notion)
    }
  }

  return (
    <div className="h-full overflow-auto">
      <div
        className="max-w-2xl mx-auto"
        style={{ padding: '24px 24px 48px' }}
      >
        <div style={{ marginBottom: 24 }}>
          <h1 className="text-xl font-semibold text-text">Settings</h1>
          <p className="text-sm text-text-muted mt-1">
            Web settings are stored on this device. Project settings apply to the connected desktop
            instance.
          </p>
        </div>

        {error && (
          <div
            className="text-xs text-danger rounded border border-danger/30 bg-danger/10 mb-6"
            style={{ padding: '8px 12px' }}
          >
            {error}
          </div>
        )}

        {/* Appearance — web-only */}
        <section
          className="bg-bg-secondary border border-border rounded-md"
          style={{ marginBottom: 24 }}
        >
          <div className="border-b border-border" style={{ padding: '14px 20px' }}>
            <h2 className="text-[11px] uppercase tracking-wider text-text-muted font-medium">
              Appearance
            </h2>
          </div>
          <div style={{ padding: '4px 0' }}>
            <div style={{ padding: '14px 20px 10px' }}>
              <div className="text-base md:text-sm text-text">Theme</div>
              <div className="text-sm md:text-xs text-text-muted mt-1 leading-relaxed">
                Applies to this browser only. Independent from your desktop theme.
              </div>
            </div>
            <ThemeRadioList />
          </div>
        </section>

        {/* Security — cloud sessions only */}
        {safetyNumber && (
          <section
            className="bg-bg-secondary border border-border rounded-md"
            style={{ marginBottom: 24 }}
          >
            <div className="border-b border-border" style={{ padding: '14px 20px' }}>
              <h2 className="text-[11px] uppercase tracking-wider text-text-muted font-medium">
                Security
              </h2>
            </div>
            <div style={{ padding: '20px' }}>
              <div className="text-base md:text-sm text-text">Safety number</div>
              <div className="text-sm md:text-xs text-text-muted mt-1 leading-relaxed">
                Compare this with the number on your desktop. They must match — if they don't, the
                connection was tampered with.
              </div>
              <code
                className="text-text"
                style={{
                  display: 'inline-block',
                  marginTop: 10,
                  fontSize: 20,
                  letterSpacing: 3,
                  padding: '8px 14px',
                  background: 'var(--color-bg)',
                  borderRadius: 6,
                  border: '1px solid var(--color-border)',
                }}
              >
                {safetyNumber}
              </code>
            </div>
          </section>
        )}

        {/* Automation — project-scoped */}
        <section
          className="bg-bg-secondary border border-border rounded-md"
          style={{ marginBottom: 24 }}
        >
          <div className="border-b border-border" style={{ padding: '14px 20px' }}>
            <h2 className="text-[11px] uppercase tracking-wider text-text-muted font-medium">
              Automation
            </h2>
          </div>
          <div style={{ padding: '20px' }}>
            {notion ? (
              <label className="flex items-start gap-4 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!notion.enabled}
                  onChange={handleNotionToggle}
                  className="w-5 h-5 mt-0.5 shrink-0"
                />
                <div className="min-w-0">
                  <div className="text-base md:text-sm text-text">Notion ticket pickup</div>
                  <div className="text-sm md:text-xs text-text-muted mt-1 leading-relaxed">
                    Automatically spawn sessions when matching Notion tickets are flagged on the
                    desktop. The picker continues running on the desktop — this toggle just
                    enables/disables it.
                  </div>
                </div>
              </label>
            ) : (
              <div className="text-xs text-text-muted">Loading…</div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
