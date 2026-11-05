import React, { useCallback, useEffect, useMemo } from 'react'
import { deskToPullRequest, involvesMe, type DeskPR } from '../../../shared/prDesk'
import { useProjectStore } from '../../stores/projectStore'
import { usePRStore } from '../../stores/prStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useEditorStore } from '../../stores/editorStore'
import { useNotificationStore } from '../../stores/notificationStore'
import { useToastStore } from '../../stores/toastStore'
import { deskProject, usePRDeskStore } from '../../stores/prDeskStore'
import { useResizable } from '../../hooks/useResizable'
import { IconButton } from '../ui/IconButton'
import { ResizeHandle } from '../ui/ResizeHandle'
import { ToggleGroup } from '../ui/ToggleGroup'
import { PRDeskBoard } from './PRDeskBoard'

const DESK_POLL_INTERVAL = 60_000
const HEADER_HEIGHT = 37

/** Icon for "send the PR list back to the sidebar". */
export const DockLeftIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="9" y1="3" x2="9" y2="21" />
  </svg>
)

/** Icon for "show the PR list as a full-width bar at the bottom". */
export const DockBottomIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="3" y1="15" x2="21" y2="15" />
  </svg>
)

/**
 * The full-width PR bar along the bottom of the window: every open PR in its
 * stage (Draft, Pending, Ready for me, Assigned, Parked), with its Notion
 * ticket when the project has the Notion integration set up.
 */
export function PRDeskBar() {
  const project = useProjectStore((s) => s.projects.find((p) => p.id === s.activeProjectId))
  const currentUser = usePRStore((s) => s.currentUser)
  const loadCurrentUser = usePRStore((s) => s.loadCurrentUser)
  const markSeen = usePRStore((s) => s.markSeen)
  const activePRNumber = useSessionStore((s) => s.activePRNumber)
  const openPR = useSessionStore((s) => s.openPR)
  const editorMode = useEditorStore((s) => s.editorMode)
  const setEditorMode = useEditorStore((s) => s.setEditorMode)
  const getContextStatus = useNotificationStore((s) => s.getContextStatus)
  const clearContextStatuses = useNotificationStore((s) => s.clearContextStatuses)
  useNotificationStore((s) => s.contextStatuses)

  const { collapsed, view, scope, height, setUI, load, loadParked, toggleParked } = usePRDeskStore()
  const data = usePRDeskStore((s) => deskProject(s, project?.id))

  const resize = useResizable({
    direction: 'vertical',
    initialSize: height,
    minSize: 96,
    maxSize: Math.max(200, (typeof window !== 'undefined' ? window.innerHeight : 900) - 160),
    inverted: true,
  })
  useEffect(() => {
    if (resize.size !== height) setUI({ height: resize.size })
  }, [resize.size])

  const projectId = project?.id
  const repoPath = project?.repoPath
  const refresh = useCallback(() => {
    if (projectId && repoPath) void load(projectId, repoPath)
  }, [projectId, repoPath, load])

  useEffect(() => {
    if (!projectId || !repoPath) return
    refresh()
    void loadParked(projectId)
    void loadCurrentUser(repoPath)
    const id = setInterval(() => {
      if (document.hidden) return
      refresh()
    }, DESK_POLL_INTERVAL)
    return () => clearInterval(id)
  }, [projectId, repoPath, refresh])

  const handleOpen = useCallback(async (pr: DeskPR) => {
    if (!project) return
    setEditorMode(false)
    markSeen(project.id, pr.number)
    clearContextStatuses(`__pr__:${pr.number}`)
    const known = usePRStore.getState().pullRequests.find((p) => p.number === pr.number)
    await openPR(project.repoPath, known ?? deskToPullRequest(pr))
  }, [project, setEditorMode, markSeen, clearContextStatuses, openPR])

  const handleOpenExternal = useCallback((url: string) => {
    window.api.prDesk.openExternal(url).catch((err: unknown) => {
      useToastStore.getState().addToast('error', err instanceof Error ? err.message : String(err))
    })
  }, [])

  const mineCount = useMemo(
    () => data.prs.filter((p) => involvesMe(p, currentUser)).length,
    [data.prs, currentUser]
  )

  if (!project) return null

  const showBody = !collapsed

  return (
    <div
      className="flex-shrink-0 flex flex-col bg-bg-secondary"
      style={{ height: showBody ? resize.size : HEADER_HEIGHT + 3 }}
      data-testid="pr-desk-bar"
    >
      {showBody ? <ResizeHandle direction="vertical" onMouseDown={resize.onMouseDown} /> : <div className="h-[3px] bg-border flex-shrink-0" />}

      <div className="flex items-center gap-2 border-b border-border flex-shrink-0" style={{ padding: '6px 12px', height: HEADER_HEIGHT }}>
        <button
          type="button"
          onClick={() => setUI({ collapsed: !collapsed })}
          className="flex items-center gap-1.5 text-text-muted hover:text-text"
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand the pull request bar' : 'Collapse the pull request bar'}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${collapsed ? '-rotate-90' : ''}`} aria-hidden>
            <polyline points="6 9 12 15 18 9" />
          </svg>
          <h2 className="text-xs font-medium uppercase tracking-wide">Pull Requests</h2>
        </button>
        <span className="text-[10px] text-text-muted tabular-nums">
          {data.prs.length} open · {mineCount} mine
        </span>
        {data.error && (
          <span className="text-[10px] text-danger truncate" title={data.error}>Couldn’t load PRs</span>
        )}
        {!data.error && data.notionError && (
          <span className="text-[10px] text-warning truncate" title={data.notionError}>Some Notion tickets didn’t load</span>
        )}

        <div className="ml-auto flex items-center gap-2">
          <ToggleGroup
            options={[
              { value: 'compact', label: 'Compact' },
              { value: 'expanded', label: 'Expanded' },
            ]}
            value={view}
            onChange={(v) => setUI({ view: v, collapsed: false })}
          />
          <ToggleGroup
            options={[
              { value: 'mine', label: 'Mine' },
              { value: 'all', label: 'All' },
            ]}
            value={scope}
            onChange={(v) => setUI({ scope: v })}
          />
          <IconButton label="Refresh pull requests" loading={data.loading} onClick={refresh} tooltipSide="top">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          </IconButton>
          <IconButton label="Move pull requests back to the sidebar" onClick={() => setUI({ open: false })} tooltipSide="top">
            <DockLeftIcon />
          </IconButton>
        </div>
      </div>

      {showBody && (
        !data.hasLoaded ? (
          <p className="text-text-muted text-xs text-center" style={{ padding: 16 }}>Loading…</p>
        ) : (
          <PRDeskBoard
            prs={data.prs}
            tickets={data.tickets}
            projects={data.projects}
            parked={data.parked}
            me={currentUser}
            view={view}
            scope={scope}
            activePRNumber={editorMode ? null : activePRNumber}
            attention={(n) => getContextStatus(`__pr__:${n}`) === 'attention'}
            onOpen={handleOpen}
            onOpenExternal={handleOpenExternal}
            onTogglePark={(n) => toggleParked(project.id, n)}
          />
        )
      )}
    </div>
  )
}
