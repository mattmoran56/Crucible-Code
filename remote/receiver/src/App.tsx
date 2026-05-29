import { useEffect, useState } from 'react'
import { wsClient, api } from './api/wsClient'
import { PairingPage } from './pages/PairingPage'
import { ProjectTabs } from './components/ProjectTabs'
import { SessionSidebar } from './components/SessionSidebar'
import { SessionWorkspace } from './components/SessionWorkspace'
import { SettingsPanel } from './components/SettingsPanel'
import { ThemePicker } from './components/ThemePicker'

interface Project {
  id: string
  name: string
  path: string
}

interface Session {
  id: string
  name: string
  branchName?: string
  worktreePath?: string
}

type Route =
  | { name: 'home' }
  | { name: 'project'; projectId: string; view: 'sessions' | 'settings' }
  | { name: 'session'; projectId: string; sessionId: string }

function parseHash(): Route {
  const h = location.hash.replace(/^#/, '')
  const parts = h.split('/').filter(Boolean)
  if (parts[0] === 'project' && parts[1] && parts[2] === 'session' && parts[3]) {
    return { name: 'session', projectId: parts[1], sessionId: parts[3] }
  }
  if (parts[0] === 'project' && parts[1] && parts[2] === 'settings') {
    return { name: 'project', projectId: parts[1], view: 'settings' }
  }
  if (parts[0] === 'project' && parts[1]) {
    return { name: 'project', projectId: parts[1], view: 'sessions' }
  }
  return { name: 'home' }
}

function buildHash(r: Route): string {
  if (r.name === 'home') return ''
  if (r.name === 'project' && r.view === 'settings') return `/project/${r.projectId}/settings`
  if (r.name === 'project') return `/project/${r.projectId}`
  return `/project/${r.projectId}/session/${r.sessionId}`
}

export function App() {
  const [token, setToken] = useState<string | null>(wsClient.getToken())
  const [connected, setConnected] = useState(false)
  const [route, setRoute] = useState<Route>(parseHash())
  const [projects, setProjects] = useState<Project[]>([])
  const [sessionsByProject, setSessionsByProject] = useState<Record<string, Session[]>>({})

  useEffect(() => {
    if (token) wsClient.connect()
    return wsClient.onConnectionChange(setConnected)
  }, [token])

  useEffect(() => {
    const onHash = () => setRoute(parseHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    if (!connected) return
    api.projects
      .list()
      .then((list) => {
        const arr = list as Project[]
        setProjects(arr)
        if (route.name === 'home' && arr.length > 0) {
          navigate({ name: 'project', projectId: arr[0].id, view: 'sessions' })
        }
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected])

  const activeProjectId =
    route.name === 'project' || route.name === 'session' ? route.projectId : null

  useEffect(() => {
    if (!activeProjectId) return
    api.sessions
      .list(activeProjectId)
      .then((list) =>
        setSessionsByProject((prev) => ({ ...prev, [activeProjectId]: list as Session[] }))
      )
      .catch(() => {})
  }, [activeProjectId])

  const navigate = (next: Route) => {
    location.hash = buildHash(next)
  }

  if (!token) {
    return <PairingPage onPaired={() => setToken(wsClient.getToken())} />
  }

  const handleUnpair = () => {
    wsClient.clearToken()
    wsClient.disconnect()
    setToken(null)
  }

  const activeSessions = activeProjectId ? sessionsByProject[activeProjectId] ?? null : null
  const activeSessionId = route.name === 'session' ? route.sessionId : null
  const activeSession =
    activeSessionId && activeSessions
      ? activeSessions.find((s) => s.id === activeSessionId) ?? null
      : null
  const settingsOpen = route.name === 'project' && route.view === 'settings'

  return (
    <div className="flex flex-col h-screen bg-bg text-text">
      {/* Top bar — branding row */}
      <header className="flex items-center h-10 bg-bg-tertiary border-b border-border shrink-0">
        <div className="flex items-center gap-2 shrink-0" style={{ padding: '0 12px' }}>
          <img src="/icon.png" alt="" className="w-5 h-5 rounded-sm" />
          <span className="text-sm font-semibold">Crucible Code</span>
          <span
            className="rounded text-[10px] uppercase tracking-wider bg-accent text-bg font-bold"
            style={{ padding: '2px 6px' }}
            title="Viewing via remote relay"
          >
            Remote
          </span>
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{
              background: connected ? 'var(--color-success)' : 'var(--color-danger)',
            }}
            title={connected ? 'Connected to desktop' : 'Disconnected'}
          />
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-1 shrink-0" style={{ padding: '0 8px' }}>
          <ThemePicker />
          <button
            onClick={handleUnpair}
            className="text-xs text-text-muted hover:text-text"
            style={{ padding: '4px 8px' }}
          >
            Unpair
          </button>
        </div>
      </header>

      {/* Project tabs row — separate strip, like the desktop's titlebar tab row */}
      {projects.length > 0 && (
        <div className="h-11 bg-bg-tertiary border-b border-border shrink-0">
          <ProjectTabs
            projects={projects}
            activeProjectId={activeProjectId}
            onSelect={(pid) => navigate({ name: 'project', projectId: pid, view: 'sessions' })}
          />
        </div>
      )}

      {/* Body — sidebar + workspace */}
      <div className="flex-1 min-h-0 flex">
        {activeProjectId ? (
          <>
            <SessionSidebar
              sessions={activeSessions}
              activeSessionId={activeSessionId}
              settingsOpen={settingsOpen}
              onSelectSession={(sid) =>
                navigate({ name: 'session', projectId: activeProjectId, sessionId: sid })
              }
              onOpenSettings={() =>
                navigate({ name: 'project', projectId: activeProjectId, view: 'settings' })
              }
            />
            <section className="flex-1 min-w-0">
              {settingsOpen ? (
                <SettingsPanel projectId={activeProjectId} />
              ) : activeSession ? (
                <SessionWorkspace session={activeSession} />
              ) : (
                <div className="h-full flex items-center justify-center text-sm text-text-muted">
                  Select a session from the sidebar.
                </div>
              )}
            </section>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-text-muted">
            {connected ? 'No projects on this instance.' : 'Connecting…'}
          </div>
        )}
      </div>
    </div>
  )
}

export type { Route }
