import { useEffect, useState } from 'react'
import { api } from '../api/wsClient'

interface NotionConfig {
  enabled?: boolean
  [k: string]: unknown
}

export function SettingsPanel({ projectId }: { projectId: string }) {
  const [notion, setNotion] = useState<NotionConfig | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.notion
      .loadConfig(projectId)
      .then((c) => setNotion((c as NotionConfig | null) ?? { enabled: false }))
      .catch((e) => setError(String(e)))
  }, [projectId])

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
      <div className="max-w-2xl mx-auto" style={{ padding: '32px 32px 64px' }}>
        <div className="mb-8">
          <h1 className="text-xl font-semibold text-text">Project settings</h1>
          <p className="text-sm text-text-muted mt-1">
            Changes apply to this project on the connected desktop instance.
          </p>
        </div>

        {error && (
          <div className="text-xs text-danger rounded border border-danger/30 bg-danger/10 mb-6"
               style={{ padding: '8px 12px' }}>
            {error}
          </div>
        )}

        <section className="bg-bg-secondary border border-border rounded-md">
          <div className="border-b border-border" style={{ padding: '12px 16px' }}>
            <h2 className="text-[11px] uppercase tracking-wider text-text-muted font-medium">
              Automation
            </h2>
          </div>
          <div style={{ padding: '16px' }}>
            {notion ? (
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!notion.enabled}
                  onChange={handleNotionToggle}
                  className="w-4 h-4 mt-0.5 shrink-0"
                />
                <div className="min-w-0">
                  <div className="text-sm text-text">Notion ticket pickup</div>
                  <div className="text-xs text-text-muted mt-1 leading-relaxed">
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
