import { useEffect, useState } from 'react'
import { api } from '../api/wsClient'
import type { Route } from '../App'

interface Session {
  id: string
  name: string
  branchName?: string
  worktreePath?: string
  createdAt?: string | number
}

interface NotionConfig {
  enabled?: boolean
  token?: string
  databaseId?: string
  [k: string]: unknown
}

export function ProjectPage({
  projectId,
  navigate,
}: {
  projectId: string
  navigate: (r: Route) => void
}) {
  const [sessions, setSessions] = useState<Session[] | null>(null)
  const [notion, setNotion] = useState<NotionConfig | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.sessions
      .list(projectId)
      .then((s) => setSessions(s as Session[]))
      .catch((e) => setError(String(e)))
    api.notion
      .loadConfig(projectId)
      .then((c) => setNotion((c as NotionConfig | null) ?? { enabled: false }))
      .catch(() => setNotion({ enabled: false }))
  }, [projectId])

  const handleNotionToggle = async () => {
    if (!notion) return
    const next = { ...notion, enabled: !notion.enabled }
    setNotion(next)
    try {
      await api.notion.saveConfig(projectId, next)
    } catch (e) {
      setError(String(e))
      setNotion(notion) // revert
    }
  }

  return (
    <div>
      <button onClick={() => navigate({ name: 'projects' })} style={{ fontSize: 12 }}>
        ← Projects
      </button>
      <h2 style={{ marginTop: 8 }}>Project</h2>

      <section
        style={{
          background: 'white',
          padding: 12,
          border: '1px solid rgba(0,0,0,0.08)',
          borderRadius: 8,
          marginBottom: 16,
        }}
      >
        <h3 style={{ marginTop: 0 }}>Settings</h3>
        {notion && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={!!notion.enabled} onChange={handleNotionToggle} />
            Notion ticket pickup
          </label>
        )}
        {!notion && <div style={{ color: '#888' }}>Loading settings…</div>}
      </section>

      <section>
        <h3 style={{ marginTop: 0 }}>Sessions</h3>
        {error && <div style={{ color: '#b91c1c' }}>{error}</div>}
        {!sessions && <div>Loading…</div>}
        {sessions && sessions.length === 0 && <div>No sessions.</div>}
        {sessions && (
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {sessions.map((s) => (
              <li
                key={s.id}
                style={{
                  padding: 10,
                  border: '1px solid rgba(0,0,0,0.08)',
                  borderRadius: 6,
                  marginBottom: 6,
                  background: 'white',
                  cursor: 'pointer',
                }}
                onClick={() => navigate({ name: 'session', projectId, sessionId: s.id })}
              >
                <strong>{s.name}</strong>
                {s.branchName && (
                  <span style={{ marginLeft: 8, fontSize: 12, color: '#666' }}>
                    {s.branchName}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
