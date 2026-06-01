interface Session {
  id: string
  name: string
  branchName?: string
  worktreePath?: string
  notionTicket?: { pageId: string; url: string; title: string }
}

const TicketIcon = () => (
  <svg
    aria-hidden="true"
    className="shrink-0"
    width="14"
    height="14"
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

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-text-muted">{label}</span>
      <span
        className={'text-sm text-text break-all ' + (mono ? 'font-mono text-xs' : '')}
        title={value}
      >
        {value}
      </span>
    </div>
  )
}

export function SessionInfo({ session }: { session: Session }) {
  const t = session.notionTicket
  return (
    <div className="flex-1 overflow-auto" style={{ padding: 20 }}>
      <div className="max-w-xl flex flex-col gap-5">
        <Field label="Session" value={session.name} />
        {session.branchName && <Field label="Branch" value={session.branchName} mono />}
        {session.worktreePath && <Field label="Worktree" value={session.worktreePath} mono />}

        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-text-muted">Notion ticket</span>
          {t ? (
            <a
              href={t.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-accent hover:underline focus:outline-none focus-visible:underline self-start"
              title={`Open Notion ticket: ${t.title}`}
            >
              <TicketIcon />
              <span className="break-all">{t.title || t.url}</span>
            </a>
          ) : (
            <span className="text-sm text-text-muted">Not linked</span>
          )}
        </div>
      </div>
    </div>
  )
}
