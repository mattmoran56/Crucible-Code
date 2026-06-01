import { useEffect } from 'react'
import { SessionStatusDot } from './StatusDot'
import { useGlobalStatus, type SessionStatus } from '../api/sessionStatus'

const BADGE_COLORS: Record<SessionStatus, string> = {
  running: 'var(--color-accent)',
  attention: 'var(--color-warning, #f7768e)',
  completed: 'var(--color-success, #9ece6a)',
}

interface Project {
  id: string
  name: string
}

interface Session {
  id: string
  name: string
  branchName?: string
}

interface Props {
  open: boolean
  onClose: () => void
  projects: Project[]
  activeProjectId: string | null
  onSelectProject: (projectId: string) => void
  sessions: Session[] | null
  activeSessionId: string | null
  settingsOpen: boolean
  onSelectSession: (sessionId: string) => void
  onOpenSettings: () => void
  onNewSession?: () => void
}

export function MobileNav({
  open,
  onClose,
  projects,
  activeProjectId,
  onSelectProject,
  sessions,
  activeSessionId,
  settingsOpen,
  onSelectSession,
  onOpenSettings,
  onNewSession,
}: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={
          'fixed inset-0 z-40 bg-black/50 transition-opacity md:hidden ' +
          (open ? 'opacity-100' : 'opacity-0 pointer-events-none')
        }
        aria-hidden={!open}
      />

      {/* Drawer */}
      <aside
        className={
          'pwa-drawer fixed top-0 left-0 bottom-0 z-50 w-72 bg-bg-secondary border-r border-border ' +
          'flex flex-col transform transition-transform md:hidden ' +
          (open ? 'translate-x-0' : '-translate-x-full')
        }
        aria-hidden={!open}
        role="dialog"
        aria-label="Navigation"
      >
        {/* Project picker — stacked chunky buttons */}
        <div className="border-b border-border shrink-0" style={{ padding: '14px 16px 6px' }}>
          <h2 className="text-[11px] uppercase tracking-wider text-text-muted font-medium">
            Project
          </h2>
        </div>
        <div className="border-b border-border overflow-auto shrink-0" style={{ maxHeight: '35vh' }}>
          {projects.length === 0 && (
            <div className="text-sm text-text-muted" style={{ padding: '12px 16px' }}>
              No projects
            </div>
          )}
          {projects.map((p) => {
            const isActive = p.id === activeProjectId
            return (
              <button
                key={p.id}
                onClick={() => onSelectProject(p.id)}
                className={
                  'block w-full text-left transition-colors border-b border-border/40 last:border-b-0 ' +
                  (isActive ? 'bg-bg' : 'hover:bg-bg-tertiary')
                }
                style={{ padding: '14px 16px' }}
              >
                <div className={'text-base truncate ' + (isActive ? 'text-accent' : 'text-text')}>
                  {p.name}
                </div>
              </button>
            )
          })}
        </div>

        {/* Sessions */}
        <div
          className="border-b border-border shrink-0 flex items-center justify-between"
          style={{ padding: '14px 16px 6px' }}
        >
          <h2 className="text-[11px] uppercase tracking-wider text-text-muted font-medium">
            Sessions
          </h2>
          {onNewSession && (
            <button
              onClick={onNewSession}
              aria-label="New session"
              className="text-accent text-xl leading-none flex items-center justify-center"
              style={{ width: 32, height: 32 }}
            >
              +
            </button>
          )}
        </div>
        <div className="flex-1 overflow-auto">
          {!sessions && (
            <div className="text-sm text-text-muted" style={{ padding: '12px 16px' }}>
              Loading…
            </div>
          )}
          {sessions && sessions.length === 0 && (
            <div className="text-sm text-text-muted" style={{ padding: '12px 16px' }}>
              No sessions in this project.
            </div>
          )}
          {(sessions ?? []).map((s) => {
            const isActive = !settingsOpen && s.id === activeSessionId
            return (
              <button
                key={s.id}
                onClick={() => onSelectSession(s.id)}
                className={
                  'block w-full text-left transition-colors border-b border-border/40 ' +
                  (isActive ? 'bg-bg' : 'hover:bg-bg-tertiary')
                }
                style={{ padding: '14px 16px' }}
              >
                <div className="flex items-center gap-2">
                  <SessionStatusDot contextId={s.id} size={10} />
                  <div className={'text-base truncate flex-1 ' + (isActive ? 'text-accent' : 'text-text')}>
                    {s.name}
                  </div>
                </div>
                {s.branchName && (
                  <div className="text-xs text-text-muted truncate mt-1 pl-[18px]">{s.branchName}</div>
                )}
              </button>
            )
          })}
        </div>

        {/* Settings */}
        <div className="border-t border-border shrink-0">
          <button
            onClick={onOpenSettings}
            className={
              'w-full text-left text-base transition-colors flex items-center gap-3 ' +
              (settingsOpen
                ? 'bg-bg text-accent'
                : 'text-text-muted hover:text-text hover:bg-bg-tertiary')
            }
            style={{ padding: '16px' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            Settings
          </button>
        </div>
      </aside>
    </>
  )
}

export function HamburgerButton({ onClick }: { onClick: () => void }) {
  const status = useGlobalStatus()
  return (
    <button
      onClick={onClick}
      aria-label={
        status === 'attention'
          ? 'Open navigation — a session needs attention'
          : status === 'completed'
            ? 'Open navigation — a session finished'
            : 'Open navigation'
      }
      className="md:hidden text-text-muted hover:text-text flex items-center justify-center relative"
      style={{ width: 48, height: 48 }}
    >
      <svg
        width="26"
        height="26"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <line x1="3" y1="6" x2="21" y2="6" />
        <line x1="3" y1="12" x2="21" y2="12" />
        <line x1="3" y1="18" x2="21" y2="18" />
      </svg>
      {status && (
        <span
          className={status === 'attention' ? 'crucible-status-dot-pulse' : ''}
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: BADGE_COLORS[status],
            border: '2px solid var(--color-bg-tertiary)',
          }}
          aria-hidden
        />
      )}
    </button>
  )
}
