import { useEffect, useState } from 'react'
import { wsClient, api, pair, pairCloud } from './api/wsClient'
import {
  initRemoteNotifications,
  requestNotificationPermission,
  useNotificationPermission,
} from './api/notifications'
import { initSessionStatus, clearContextStatus } from './api/sessionStatus'
import { PairingPage } from './pages/PairingPage'
import { HandlePage } from './pages/HandlePage'
import { getStoredHandle, getCloudToken, getStoredTicket } from './api/cloud'
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
  baseBranch?: string
  notionTicket?: { pageId: string; url: string; title: string }
  viewedFiles?: string[]
}

type Route =
  | { name: 'home' }
  | { name: 'project'; projectId: string; view: 'sessions' | 'settings' }
  | { name: 'session'; projectId: string; sessionId: string }

/**
 * Parse `#pair=<base64url(JSON)>` written into the URL by a QR-code scan.
 * Returns null if absent or malformed. Strips the hash from the URL as a
 * side-effect so a reload doesn't replay the pair attempt (and so the secret
 * stops being visible in the address bar).
 */
function consumePairPayload(): { secret: string; handle?: string } | null {
  const h = location.hash.replace(/^#/, '')
  const params = new URLSearchParams(h)
  const raw = params.get('pair')
  if (!raw) return null
  try {
    const b64 = raw.replace(/-/g, '+').replace(/_/g, '/')
    const json = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
    const data = JSON.parse(json) as { v?: number; secret?: string; handle?: string }
    // Clear the hash so reloads don't re-trigger and the URL bar stops leaking
    // the secret. preserveScroll by using replaceState.
    history.replaceState(null, '', location.pathname + location.search)
    if (!data.secret) return null
    return { secret: data.secret, handle: data.handle }
  } catch {
    return null
  }
}

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
  const [cloudHandle, setCloudHandle] = useState<string | null>(
    getStoredHandle() && getStoredTicket() ? getStoredHandle() : null
  )
  const [connected, setConnected] = useState(false)
  const [route, setRoute] = useState<Route>(parseHash())
  const [projects, setProjects] = useState<Project[]>([])
  const [sessionsByProject, setSessionsByProject] = useState<Record<string, Session[]>>({})
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  const [autoPairError, setAutoPairError] = useState<string | null>(null)

  useEffect(() => {
    initRemoteNotifications()
    initSessionStatus()
    const pairPayload = consumePairPayload()
    void wsClient.detectMode().then(async (m) => {
      setMode(m)
      if (!pairPayload) return
      const label = navigator.userAgent.split(/[()]/)[1] || 'browser'
      try {
        if (m === 'cloud') {
          if (!pairPayload.handle) {
            setAutoPairError('QR is missing a cloud handle.')
            return
          }
          await pairCloud(pairPayload.handle.trim().toLowerCase(), pairPayload.secret)
          setCloudHandle(getStoredHandle())
        } else {
          await pair(pairPayload.secret, label)
          setToken(wsClient.getToken())
        }
      } catch (err) {
        setAutoPairError(err instanceof Error ? err.message : String(err))
      }
    })
  }, [])

  useEffect(() => {
    if (mode === null) return
    const hasAuth =
      mode === 'lan'
        ? !!token
        : !!cloudHandle && !!getStoredTicket() && !!getCloudToken()
    if (hasAuth) wsClient.connect()
    return wsClient.onConnectionChange(setConnected)
  }, [mode, token, cloudHandle])

  useEffect(() => {
    const onHash = () => setRoute(parseHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // Edge-swipe to open the mobile drawer (and swipe-left to close it).
  // Swiping right from the left edge opens the drawer instead of triggering
  // the browser's back gesture. Only active below the md breakpoint where
  // the drawer exists.
  useEffect(() => {
    const EDGE_PX = 24
    const THRESHOLD_PX = 50
    const SLOPE = 1.2 // horizontal must dominate vertical by this factor
    let startX = 0
    let startY = 0
    let tracking: 'open' | 'close' | null = null
    let openAtStart = false

    const onStart = (e: TouchEvent) => {
      if (window.innerWidth >= 768) return
      if (e.touches.length !== 1) return
      const t = e.touches[0]
      openAtStart = mobileNavOpen
      if (!openAtStart && t.clientX <= EDGE_PX) {
        tracking = 'open'
        startX = t.clientX
        startY = t.clientY
      } else if (openAtStart) {
        tracking = 'close'
        startX = t.clientX
        startY = t.clientY
      } else {
        tracking = null
      }
    }
    const onMove = (e: TouchEvent) => {
      if (!tracking) return
      const t = e.touches[0]
      const dx = t.clientX - startX
      const dy = t.clientY - startY
      if (Math.abs(dx) > Math.abs(dy) * SLOPE && Math.abs(dx) > 10) {
        // Horizontal swipe — block browser back-swipe / scroll while we own it.
        if (e.cancelable) e.preventDefault()
      }
    }
    const onEnd = (e: TouchEvent) => {
      if (!tracking) return
      const t = e.changedTouches[0]
      const dx = t.clientX - startX
      const dy = t.clientY - startY
      const horizontal = Math.abs(dx) > Math.abs(dy) * SLOPE
      if (tracking === 'open' && horizontal && dx > THRESHOLD_PX) {
        setMobileNavOpen(true)
      } else if (tracking === 'close' && horizontal && dx < -THRESHOLD_PX) {
        setMobileNavOpen(false)
      }
      tracking = null
    }

    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('touchend', onEnd, { passive: true })
    window.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
      window.removeEventListener('touchcancel', onEnd)
    }
  }, [mobileNavOpen])

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
    // Mirror desktop behaviour: clicking into a session clears its status
    // indicator so the sidebar dot reflects "user has seen this".
    if (next.name === 'session') clearContextStatus(next.sessionId)
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
    return <PairingPage initialError={autoPairError} onPaired={() => setToken(wsClient.getToken())} />
  }

  if (mode === 'cloud' && !connected && (!cloudHandle || !getStoredTicket())) {
    return <HandlePage initialError={autoPairError} onPaired={() => setCloudHandle(getStoredHandle())} />
  }

  const handleUnpair = () => {
    if (mode === 'lan') {
      wsClient.clearToken()
      setToken(null)
    } else {
      // Cloud
      localStorage.removeItem('codecrucible-remote-handle')
      localStorage.removeItem('codecrucible-remote-cloud-token')
      localStorage.removeItem('codecrucible-remote-ticket')
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
          <NotificationsButton />
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
                <SessionWorkspace
                  session={activeSession}
                  onUpdateSession={async (next) => {
                    const list = (sessionsByProject[activeProjectId] ?? []).map((s) =>
                      s.id === next.id ? next : s
                    )
                    setSessionsByProject((prev) => ({ ...prev, [activeProjectId]: list }))
                    try {
                      await api.sessions.save(activeProjectId, list)
                    } catch {
                      // ignore — list refresh poll will reconcile on next tick
                    }
                  }}
                />
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

function NotificationsButton() {
  const permission = useNotificationPermission()
  if (permission === 'granted') return null
  const label = permission === 'denied' ? 'Notifications blocked' : 'Enable notifications'
  return (
    <button
      onClick={async () => {
        const result = await requestNotificationPermission()
        if (result === 'denied') {
          alert(
            'Notifications are blocked. On iOS: add this app to your home screen, then re-open and tap "Enable notifications".',
          )
        }
      }}
      className="text-text-muted hover:text-text text-sm md:text-xs"
      style={{ padding: '8px 12px' }}
    >
      {label}
    </button>
  )
}

export type { Route }
