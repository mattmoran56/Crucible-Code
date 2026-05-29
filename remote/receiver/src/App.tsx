import { useEffect, useState } from 'react'
import { wsClient } from './api/wsClient'
import { PairingPage } from './pages/PairingPage'
import { ProjectsPage } from './pages/ProjectsPage'
import { ProjectPage } from './pages/ProjectPage'
import { SessionPage } from './pages/SessionPage'

type Route =
  | { name: 'projects' }
  | { name: 'project'; projectId: string }
  | { name: 'session'; projectId: string; sessionId: string }

function parseHash(): Route {
  const h = location.hash.replace(/^#/, '')
  const parts = h.split('/').filter(Boolean)
  if (parts[0] === 'project' && parts[1] && parts[2] === 'session' && parts[3]) {
    return { name: 'session', projectId: parts[1], sessionId: parts[3] }
  }
  if (parts[0] === 'project' && parts[1]) return { name: 'project', projectId: parts[1] }
  return { name: 'projects' }
}

export function App() {
  const [token, setToken] = useState<string | null>(wsClient.getToken())
  const [connected, setConnected] = useState(false)
  const [route, setRoute] = useState<Route>(parseHash())

  useEffect(() => {
    if (token) wsClient.connect()
    return wsClient.onConnectionChange(setConnected)
  }, [token])

  useEffect(() => {
    const onHash = () => setRoute(parseHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  if (!token) {
    return <PairingPage onPaired={() => setToken(wsClient.getToken())} />
  }

  const handleUnpair = () => {
    wsClient.clearToken()
    wsClient.disconnect()
    setToken(null)
  }

  const navigate = (next: Route) => {
    if (next.name === 'projects') location.hash = ''
    else if (next.name === 'project') location.hash = `/project/${next.projectId}`
    else location.hash = `/project/${next.projectId}/session/${next.sessionId}`
  }

  return (
    <div style={{ fontFamily: 'system-ui', minHeight: '100vh', background: '#faf6f1' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 16px',
          borderBottom: '1px solid rgba(0,0,0,0.08)',
          background: 'white',
        }}
      >
        <strong>Crucible Code — Remote</strong>
        <span
          title={connected ? 'Connected' : 'Disconnected'}
          style={{
            display: 'inline-block',
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: connected ? '#22c55e' : '#ef4444',
          }}
        />
        <nav style={{ display: 'flex', gap: 8, marginLeft: 16, fontSize: 14 }}>
          <a href="#" onClick={(e) => { e.preventDefault(); navigate({ name: 'projects' }) }}>Projects</a>
        </nav>
        <button onClick={handleUnpair} style={{ marginLeft: 'auto', fontSize: 12 }}>
          Unpair
        </button>
      </header>
      <main style={{ padding: 16 }}>
        {!connected && <div style={{ color: '#888', marginBottom: 12 }}>Reconnecting…</div>}
        {route.name === 'projects' && <ProjectsPage navigate={navigate} />}
        {route.name === 'project' && (
          <ProjectPage projectId={route.projectId} navigate={navigate} />
        )}
        {route.name === 'session' && (
          <SessionPage projectId={route.projectId} sessionId={route.sessionId} navigate={navigate} />
        )}
      </main>
    </div>
  )
}

export type { Route }
