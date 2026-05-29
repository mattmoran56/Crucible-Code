import { useEffect, useState } from 'react'
import { wsClient, api } from './api/wsClient'
import { PairingPage } from './pages/PairingPage'
import { HandlePage } from './pages/HandlePage'
import { getStoredHandle, getCloudToken } from './api/cloud'
import { ProjectTabs } from './components/ProjectTabs'
import { SessionSidebar } from './components/SessionSidebar'
import { SessionWorkspace } from './components/SessionWorkspace'
import { SettingsPanel } from './components/SettingsPanel'
import { MobileNav, HamburgerButton } from './components/MobileNav'

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
  const [mode, setMode] = useState<'lan' | 'cloud' | null>(null)
  const [token, setToken] = useState<string | null>(wsClient.getToken())
  const [cloudHandle, setCloudHandle] = useState<string | null>(getStoredHandle())
  const [connected, setConnected] = useState(false)
  const [route, setRoute] = useState<Route>(parseHash())
  const [projects, setProjects] = useState<Project[]>([])
  const [sessionsByProject, setSessionsByProject] = useState<Record<string, Session[]>>({})
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  useEffect(() => {
    void wsClient.detectMode().then(setMode)
  }, [])

  useEffect(() => {
    if (mode === null) return
    const hasAuth = mode === 'lan' ? !!token : !!cloudHandle && !!getCloudToken()
    if (hasAuth) wsClient.connect()
    return wsClient.onConnectionChange(setConnected)
  }, [mode, token, cloudHandle])

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

  if (mode === null) {
    return (
      <div className="min-h-screen bg-bg text-text flex items-center justify-center text-sm text-text-muted">
        Connecting…
      </div>
    )
  }

  if (mode === 'lan' && !token) {
    return <PairingPage onPaired={() => setToken(wsClient.getToken())} />
  }

  if (mode === 'cloud' && !connected && !cloudHandle) {
    return <HandlePage onPaired={() => setCloudHandle(getStoredHandle())} />
  }

  const handleUnpair = () => {
    if (mode === 'lan') {
      wsClient.clearToken()
      setToken(null)
    } else {
      // Cloud
      localStorage.removeItem('codecrucible-remote-handle')
      localStorage.removeItem('codecrucible-remote-cloud-token')
      setCloudHandle(null)
    }
    wsClient.disconnect()
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
      {/* Top bar — branding row. Taller on mobile for thumb-friendly hit area. */}
      <header className="pwa-header flex items-center h-14 md:h-10 bg-bg-tertiary border-b border-border shrink-0">
        <HamburgerButton onClick={() => setMobileNavOpen(true)} />
        <div className="flex items-center gap-2 shrink-0" style={{ padding: '0 12px' }}>
          <img src="/icon.png" alt="" className="w-7 h-7 md:w-5 md:h-5 rounded-sm" />
          <span className="text-base md:text-sm font-semibold">Crucible Code</span>
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
          <button
            onClick={handleUnpair}
            className="text-text-muted hover:text-text text-sm md:text-xs"
            style={{ padding: '8px 12px' }}
          >
            Unpair
          </button>
        </div>
      </header>

      {/* Project tabs row — hidden on mobile, shown on md+ */}
      {projects.length > 0 && (
        <div className="pwa-tabs hidden md:block h-11 bg-bg-tertiary border-b border-border shrink-0">
          <ProjectTabs
            projects={projects}
            activeProjectId={activeProjectId}
            onSelect={(pid) => navigate({ name: 'project', projectId: pid, view: 'sessions' })}
          />
        </div>
      )}

      {/* Mobile drawer */}
      <MobileNav
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        projects={projects}
        activeProjectId={activeProjectId}
        onSelectProject={(pid) => {
          navigate({ name: 'project', projectId: pid, view: 'sessions' })
        }}
        sessions={activeSessions}
        activeSessionId={activeSessionId}
        settingsOpen={settingsOpen}
        onSelectSession={(sid) => {
          if (activeProjectId) {
            navigate({ name: 'session', projectId: activeProjectId, sessionId: sid })
            setMobileNavOpen(false)
          }
        }}
        onOpenSettings={() => {
          if (activeProjectId) {
            navigate({ name: 'project', projectId: activeProjectId, view: 'settings' })
            setMobileNavOpen(false)
          }
        }}
      />

      {/* Body — sidebar (md+) + workspace */}
      <div className="flex-1 min-h-0 flex">
        {activeProjectId ? (
          <>
            <div className="hidden md:flex">
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
            </div>
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
