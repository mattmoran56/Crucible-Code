import { Sidebar, SidebarSection } from '@renderer/components/ui/Sidebar'
import { SessionStatusDot } from './StatusDot'

interface Session {
  id: string
  name: string
  branchName?: string
  notionTicket?: { pageId: string; url: string; title: string }
}

const TicketIcon = () => (
  <svg
    aria-hidden="true"
    className="shrink-0"
    width="10"
    height="10"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V8z" />
    <path d="M13 6v2" />
    <path d="M13 11v2" />
    <path d="M13 16v2" />
  </svg>
)

interface Props {
  sessions: Session[] | null
  activeSessionId: string | null
  settingsOpen: boolean
  onSelectSession: (sessionId: string) => void
  onOpenSettings: () => void
}

export function SessionSidebar({
  sessions,
  activeSessionId,
  settingsOpen,
  onSelectSession,
  onOpenSettings,
}: Props) {
  return (
    <Sidebar className="w-56 shrink-0 border-r border-border">
      <SidebarSection title="Sessions">
        {!sessions && <div className="text-xs text-text-muted">Loading…</div>}
        {sessions && sessions.length === 0 && (
          <div className="text-xs text-text-muted">No sessions in this project.</div>
        )}
        {(sessions ?? []).map((s) => {
          const isActive = !settingsOpen && s.id === activeSessionId
          return (
            <button
              key={s.id}
              onClick={() => onSelectSession(s.id)}
              className={
                'block w-full text-left rounded transition-colors group ' +
                (isActive ? 'bg-bg' : 'hover:bg-bg-tertiary')
              }
              style={{ padding: '8px 10px' }}
            >
              <div className="flex items-center gap-2">
                <SessionStatusDot contextId={s.id} size={7} />
                <div
                  className={
                    'text-sm truncate flex-1 ' +
                    (isActive
                      ? 'text-accent'
                      : 'text-text group-hover:text-accent transition-colors')
                  }
                >
                  {s.name}
                </div>
              </div>
              {s.branchName && (
                <div className="text-[11px] text-text-muted truncate mt-0.5 pl-[15px]">{s.branchName}</div>
              )}
              {s.notionTicket && (
                <span
                  role="link"
                  tabIndex={0}
                  title={`Open Notion ticket: ${s.notionTicket.title}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    window.open(s.notionTicket!.url, '_blank', 'noopener,noreferrer')
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      e.stopPropagation()
                      window.open(s.notionTicket!.url, '_blank', 'noopener,noreferrer')
                    }
                  }}
                  className="mt-1 pl-[15px] flex items-center gap-1 text-text-muted text-[10px] hover:text-accent hover:underline cursor-pointer focus:outline-none focus-visible:text-accent max-w-full"
                >
                  <TicketIcon />
                  <span className="truncate">{s.notionTicket.title || 'Notion ticket'}</span>
                </span>
              )}
            </button>
          )
        })}
      </SidebarSection>
      <div className="border-t border-border shrink-0">
        <button
          onClick={onOpenSettings}
          className={
            'w-full text-left text-sm transition-colors flex items-center gap-2 ' +
            (settingsOpen
              ? 'bg-bg text-accent'
              : 'text-text-muted hover:text-text hover:bg-bg-tertiary')
          }
          style={{ padding: '10px 12px' }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          Settings
        </button>
      </div>
    </Sidebar>
  )
}
