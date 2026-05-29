import { useEffect, useState } from 'react'
import { api } from '../api/wsClient'
import type { Route } from '../App'
import { RemoteTerminal } from '../components/RemoteTerminal'

interface Session {
  id: string
  name: string
  worktreePath?: string
}

interface TerminalRef {
  terminalId: string
  mode: string
  tabId: string
  contextId: string
}

function labelFor(t: TerminalRef): string {
  if (t.tabId === 'agent') return 'Agent'
  if (t.tabId === 'review') return 'Review'
  if (t.tabId.startsWith('agent:')) return `Agent ${t.tabId.slice(6)}`
  if (t.tabId.startsWith('terminal:')) return `Terminal ${t.tabId.slice(9)}`
  return t.tabId
}

export function SessionPage({
  projectId,
  sessionId,
  navigate,
}: {
  projectId: string
  sessionId: string
  navigate: (r: Route) => void
}) {
  const [session, setSession] = useState<Session | null>(null)
  const [terminals, setTerminals] = useState<TerminalRef[] | null>(null)
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.sessions
      .list(projectId)
      .then((list) => {
        const s = (list as Session[]).find((x) => x.id === sessionId)
        setSession(s ?? null)
      })
      .catch((e) => setError(String(e)))
  }, [projectId, sessionId])

  const refreshTerminals = () => {
    api.terminal
      .listForSession(sessionId)
      .then((list) => {
        const arr = list as TerminalRef[]
        setTerminals(arr)
        setActiveTabId((prev) => {
          if (prev && arr.some((t) => t.tabId === prev)) return prev
          return arr[0]?.tabId ?? null
        })
      })
      .catch((e) => setError(String(e)))
  }

  useEffect(() => {
    refreshTerminals()
    const t = window.setInterval(refreshTerminals, 4000)
    return () => window.clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  const handleSpawnShell = async () => {
    if (!session?.worktreePath) return
    const nextTabIndex =
      (terminals?.filter((t) => t.tabId.startsWith('terminal:')).length ?? 0) + 1
    const tabId = `terminal:${nextTabIndex}`
    try {
      await api.terminal.spawn(
        sessionId,
        session.worktreePath,
        'shell',
        'dark',
        undefined,
        session.worktreePath,
        false,
        sessionId,
        tabId
      )
      refreshTerminals()
      setActiveTabId(tabId)
    } catch (e) {
      setError(String(e))
    }
  }

  const active = terminals?.find((t) => t.tabId === activeTabId) ?? null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 80px)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <button onClick={() => navigate({ name: 'project', projectId })} style={{ fontSize: 12 }}>
          ← Project
        </button>
        <strong style={{ fontSize: 16 }}>{session?.name ?? 'Session'}</strong>
        {session?.worktreePath && (
          <code style={{ fontSize: 11, color: '#666' }}>{session.worktreePath}</code>
        )}
      </div>

      {error && <div style={{ color: '#b91c1c' }}>{error}</div>}

      <div
        style={{
          display: 'flex',
          gap: 4,
          borderBottom: '1px solid rgba(0,0,0,0.1)',
          background: 'white',
          padding: '4px 4px 0',
          borderRadius: '6px 6px 0 0',
        }}
      >
        {(terminals ?? []).map((t) => (
          <button
            key={t.tabId}
            onClick={() => setActiveTabId(t.tabId)}
            style={{
              padding: '6px 12px',
              border: 'none',
              background: t.tabId === activeTabId ? '#1a1a1a' : 'transparent',
              color: t.tabId === activeTabId ? 'white' : '#333',
              borderRadius: '4px 4px 0 0',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            {labelFor(t)}
          </button>
        ))}
        <button
          onClick={handleSpawnShell}
          title="Open a new shell tab"
          style={{
            marginLeft: 'auto',
            padding: '6px 10px',
            fontSize: 12,
            background: 'transparent',
            border: '1px dashed rgba(0,0,0,0.2)',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          + Shell
        </button>
      </div>

      {terminals && terminals.length === 0 && (
        <div style={{ padding: 24, color: '#666' }}>
          No active terminals in this session. Open one on your desktop, or click "+ Shell" to start
          a remote shell.
        </div>
      )}

      {active && (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <RemoteTerminal key={active.terminalId} terminalId={active.terminalId} />
        </div>
      )}
    </div>
  )
}
