import { useEffect, useState } from 'react'
import { api } from '../api/wsClient'
import { RemoteTerminal } from './RemoteTerminal'
import { WorktreeDiff } from './WorktreeDiff'
import { SessionInfo } from './SessionInfo'

const DIFF_TAB_ID = '__diff__'
const INFO_TAB_ID = '__info__'

interface Session {
  id: string
  name: string
  branchName?: string
  worktreePath?: string
  notionTicket?: { pageId: string; url: string; title: string }
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

function labelForTabId(tabId: string): string {
  if (tabId === DIFF_TAB_ID) return 'Diff'
  if (tabId === INFO_TAB_ID) return 'Info'
  return tabId
}

export function SessionWorkspace({ session }: { session: Session }) {
  const [terminals, setTerminals] = useState<TerminalRef[] | null>(null)
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refreshTerminals = () => {
    api.terminal
      .listForSession(session.id)
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
  }, [session.id])

  const handleSpawnShell = async () => {
    if (!session.worktreePath) return
    const nextTabIndex =
      (terminals?.filter((t) => t.tabId.startsWith('terminal:')).length ?? 0) + 1
    const tabId = `terminal:${nextTabIndex}`
    try {
      await api.terminal.spawn(
        session.id,
        session.worktreePath,
        'shell',
        'dark',
        undefined,
        session.worktreePath,
        false,
        session.id,
        tabId
      )
      refreshTerminals()
      setActiveTabId(tabId)
    } catch (e) {
      setError(String(e))
    }
  }

  const active = terminals?.find((t) => t.tabId === activeTabId) ?? null
  const isDiffActive = activeTabId === DIFF_TAB_ID
  const isInfoActive = activeTabId === INFO_TAB_ID
  const showDiffTab = !!session.worktreePath

  return (
    <div className="h-full flex flex-col">
      {error && <div className="text-xs text-danger px-3 py-1.5 bg-danger/10">{error}</div>}

      {/* Workspace tab strip — h-14 on mobile for thumb-friendly tabs, scrolls horizontally if overflowing. */}
      <div
        role="tablist"
        className="flex items-stretch bg-bg-tertiary border-b border-border shrink-0 overflow-x-auto min-h-14 md:gap-0 md:px-1 md:min-h-9"
        style={{ gap: 12, paddingLeft: 12, paddingRight: 12 }}
      >
        {(terminals ?? []).map((t) => {
          const isActive = t.tabId === activeTabId
          return (
            <button
              key={t.tabId}
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTabId(t.tabId)}
              className={
                'relative flex items-center justify-center gap-1.5 transition-colors shrink-0 ' +
                'text-base md:text-xs md:px-2.5 md:py-2 ' +
                (isActive
                  ? 'text-text bg-bg md:bg-transparent'
                  : 'text-text-muted hover:text-text')
              }
              style={{ paddingLeft: 24, paddingRight: 24 }}
            >
              {labelFor(t)}
              {isActive && (
                <span className="absolute left-0 right-0 bottom-0 h-[3px] md:h-[2px] bg-accent rounded-t" />
              )}
            </button>
          )
        })}
        {showDiffTab && (
          <button
            role="tab"
            aria-selected={isDiffActive}
            onClick={() => setActiveTabId(DIFF_TAB_ID)}
            className={
              'relative flex items-center justify-center gap-1.5 transition-colors shrink-0 ' +
              'text-base md:text-xs md:px-2.5 md:py-2 ' +
              (isDiffActive
                ? 'text-text bg-bg md:bg-transparent'
                : 'text-text-muted hover:text-text')
            }
            style={{ paddingLeft: 24, paddingRight: 24 }}
            title="View live worktree diff"
          >
            {labelForTabId(DIFF_TAB_ID)}
            {isDiffActive && (
              <span className="absolute left-0 right-0 bottom-0 h-[3px] md:h-[2px] bg-accent rounded-t" />
            )}
          </button>
        )}
        <button
          role="tab"
          aria-selected={isInfoActive}
          onClick={() => setActiveTabId(INFO_TAB_ID)}
          className={
            'relative flex items-center justify-center gap-1.5 transition-colors shrink-0 ' +
            'text-base md:text-xs md:px-2.5 md:py-2 ' +
            (isInfoActive
              ? 'text-text bg-bg md:bg-transparent'
              : 'text-text-muted hover:text-text')
          }
          style={{ paddingLeft: 24, paddingRight: 24 }}
          title="Session info"
        >
          {labelForTabId(INFO_TAB_ID)}
          {isInfoActive && (
            <span className="absolute left-0 right-0 bottom-0 h-[3px] md:h-[2px] bg-accent rounded-t" />
          )}
        </button>
        <button
          onClick={handleSpawnShell}
          title="Open a new shell tab"
          className="text-text-muted hover:text-text shrink-0 text-xl md:text-xs md:px-2.5 md:py-2"
          style={{ paddingLeft: 20, paddingRight: 20 }}
        >
          +
        </button>
      </div>

      <div className="flex-1 min-h-0 bg-bg flex flex-col">
        {isInfoActive ? (
          <SessionInfo session={session} />
        ) : isDiffActive && session.worktreePath ? (
          <WorktreeDiff worktreePath={session.worktreePath} />
        ) : terminals && terminals.length === 0 ? (
          <div className="text-sm text-text-muted" style={{ padding: 24 }}>
            No active terminals in this session. Open one on your desktop, or click "+" to start a
            remote shell.
          </div>
        ) : active ? (
          <RemoteTerminal key={active.terminalId} terminalId={active.terminalId} />
        ) : (
          <div className="text-sm text-text-muted" style={{ padding: 24 }}>
            Loading…
          </div>
        )}
      </div>
    </div>
  )
}
