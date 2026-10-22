import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import { useProjectStore } from '../../stores/projectStore'
import { useTerminalStore } from '../../stores/terminalStore'
import { useWorkspaceLayoutStore } from '../../stores/workspaceLayoutStore'
import { useToastStore } from '../../stores/toastStore'
import { Button } from '../ui'
import type { SandboxInfo, SandboxJob, SandboxLinkState, Session } from '../../../shared/types'

/** Poll quickly while something is coming up, slowly once everything answers. */
const FAST_POLL_MS = 3_000
const SLOW_POLL_MS = 10_000

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/** Interactive commands (logs -f, shell) still belong in a terminal tab. */
async function runInSessionTerminal(session: Session, command: string): Promise<void> {
  const terminalId = await window.api.button.execute(
    command,
    session.worktreePath,
    'shell',
    'terminal',
    session.id
  )
  const { columns, addDynamicTab } = useWorkspaceLayoutStore.getState()
  const columnId = columns[0]?.id
  if (!columnId) return
  const tab = addDynamicTab(columnId, 'terminal')
  useTerminalStore.getState().registerDynamicTerminal(tab, terminalId, session.id, session.name, 'shell')
}

const SUCCESS = 'var(--color-success, #3fb950)'
const DANGER = 'var(--color-danger, #f85149)'
const WARNING = 'var(--color-warning, #d29922)'
const MUTED = 'var(--color-text-muted)'

function stateColour(state: string): string {
  if (state === 'running') return SUCCESS
  if (state === 'degraded' || state === 'failed') return DANGER
  if (state === 'stopped' || state === 'exited') return MUTED
  return WARNING
}

const LINK_TEXT: Record<SandboxLinkState, string> = {
  ready: 'Ready',
  starting: 'Not answering yet',
  'not-built': 'Not built in this sandbox',
}
const LINK_COLOUR: Record<SandboxLinkState, string> = {
  ready: SUCCESS,
  starting: WARNING,
  'not-built': MUTED,
}

function Dot({ colour, pulse }: { colour: string; pulse?: boolean }) {
  return (
    <span
      className={`shrink-0 ${pulse ? 'animate-pulse' : ''}`}
      style={{ width: 7, height: 7, borderRadius: 4, background: colour, display: 'inline-block' }}
    />
  )
}

function elapsed(from: string, to?: string): string {
  const secs = Math.max(0, Math.round(((to ? Date.parse(to) : Date.now()) - Date.parse(from)) / 1000))
  return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, '0')}s`
}

/** A running or finished `sandboxer up` / build, with its output. */
function JobCard({ job, onCancel, onDismiss }: { job: SandboxJob; onCancel: () => void; onDismiss: () => void }) {
  const [open, setOpen] = useState(job.state === 'failed')
  const [, tick] = useState(0)
  const logRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    if (job.state === 'failed') setOpen(true)
    if (job.state !== 'running') return
    const timer = setInterval(() => tick((t) => t + 1), 1_000)
    return () => clearInterval(timer)
  }, [job.state])

  useEffect(() => {
    if (open && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [open, job.lines.length])

  const running = job.state === 'running'
  const colour = running ? WARNING : job.state === 'succeeded' ? SUCCESS : DANGER
  const headline = running
    ? (job.step ?? 'Starting…')
    : job.state === 'succeeded'
      ? 'Done'
      : `Failed${job.exitCode != null ? ` (exit ${job.exitCode})` : ''}`

  return (
    <div className="border border-border rounded-md flex flex-col gap-2" style={{ padding: 10, marginBottom: 12 }} data-testid="sandbox-job">
      <div className="flex items-center gap-2">
        <Dot colour={colour} pulse={running} />
        <span className="text-xs font-medium text-text">{job.title}</span>
        <span className="text-[11px] text-text-muted ml-auto">{elapsed(job.startedAt, job.finishedAt)}</span>
      </div>
      <p className="text-[11px] text-text-muted truncate" title={headline}>
        {headline}
      </p>
      <div className="flex gap-2">
        <Button size="sm" variant="ghost" className="border border-border" onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide output' : 'Show output'}
        </Button>
        {running ? (
          <Button size="sm" variant="ghost" className="border border-border" onClick={onCancel}>
            Cancel
          </Button>
        ) : (
          <Button size="sm" variant="ghost" className="border border-border" onClick={onDismiss}>
            Dismiss
          </Button>
        )}
      </div>
      {open && (
        <pre
          ref={logRef}
          className="text-[10px] font-mono text-text-muted bg-bg rounded overflow-auto whitespace-pre-wrap break-all"
          style={{ maxHeight: 220, padding: 8, margin: 0 }}
        >
          {job.lines.join('\n')}
        </pre>
      )}
    </div>
  )
}

/**
 * Right-panel view of the active session's Sandboxer sandbox: progress of
 * `sandboxer up` and builds, the sandbox's state, and every URL with whether it
 * answers yet. Only polls while open, and only for projects with Sandboxer on.
 */
export function SandboxPanel() {
  const { sessions, activeSessionId } = useSessionStore()
  const projects = useProjectStore((s) => s.projects)
  const addToast = useToastStore((s) => s.addToast)
  const session = sessions.find((s) => s.id === activeSessionId) ?? null
  const project = session ? projects.find((p) => p.id === session.projectId) ?? null : null
  const enabled = !!project?.sandboxer?.enabled

  const [sandboxes, setSandboxes] = useState<SandboxInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [job, setJob] = useState<SandboxJob | null>(null)
  const [dismissedJob, setDismissedJob] = useState<string | null>(null)

  const worktreePath = session?.worktreePath
  const refresh = useCallback(async () => {
    if (!worktreePath) return
    try {
      setSandboxes(await window.api.sandboxer.status(worktreePath))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [worktreePath])

  useEffect(() => {
    setSandboxes(null)
    setError(null)
  }, [worktreePath])

  // The job for this worktree: whatever is already running, then live updates.
  useEffect(() => {
    setJob(null)
    if (!enabled || !worktreePath) return
    let cancelled = false
    void window.api.sandboxer.job(worktreePath).then((j) => {
      if (!cancelled && j) setJob((current) => current ?? j)
    })
    const off = window.api.sandboxer.onJobEvent((j) => {
      if (j.worktreePath !== worktreePath) return
      setJob(j)
      // Finished: look at the sandbox now rather than at the next poll.
      if (j.state !== 'running') void refresh()
    })
    return () => {
      cancelled = true
      off()
    }
  }, [enabled, worktreePath, refresh])

  const settling =
    job?.state === 'running' ||
    !!sandboxes?.some((sb) => sb.state !== 'running' || Object.values(sb.links ?? {}).includes('starting'))

  useEffect(() => {
    if (!enabled || !worktreePath) return
    void refresh()
    const timer = setInterval(() => void refresh(), settling ? FAST_POLL_MS : SLOW_POLL_MS)
    return () => clearInterval(timer)
  }, [enabled, worktreePath, refresh, settling])

  if (!session || !project) {
    return <Empty>Select a session to see its sandbox.</Empty>
  }
  if (!enabled) {
    return <Empty>Sandboxer is off for {project.name}. Turn it on in Settings → Sandboxer.</Empty>
  }

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label)
    try {
      await fn()
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
      void refresh()
    }
  }

  const jobRunning = job?.state === 'running'
  const up = () =>
    act('up', async () => {
      setJob(await window.api.sandboxer.up(project.repoPath, session.worktreePath, project.sandboxer?.configPath))
    })

  const build = (sb: SandboxInfo, label: string) =>
    act(`build:${label}`, async () => {
      setJob(await window.api.sandboxer.build(sb, label))
    })

  const destroy = () => {
    if (!confirm('Destroy this sandbox? Its container, database and uploads are deleted. The worktree stays.')) return
    void act('down', async () => {
      const report = await window.api.sandboxer.down(session.worktreePath)
      if (report.failed.length > 0) throw new Error(`Could not destroy: ${report.failed.join('; ')}`)
      if (report.skipped) throw new Error(`Sandboxer unavailable: ${report.skipped}`)
    })
  }

  const target = (sb: SandboxInfo) => `${shellQuote(sb.slug)} --project ${shellQuote(sb.project)}`
  const showJob = job && job.startedAt !== dismissedJob

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto" style={{ padding: 12 }}>
      {error && (
        <p className="text-[11px] text-danger" style={{ marginBottom: 8 }}>
          {error}
        </p>
      )}

      {session.location === 'cloud' && (
        <p className="text-[11px] text-text-muted" style={{ marginBottom: 8 }}>
          This session runs in the cloud; a sandbox runs the local worktree, which may be behind.
        </p>
      )}

      {showJob && (
        <JobCard
          job={job}
          onCancel={() => void window.api.sandboxer.cancelJob(session.worktreePath)}
          onDismiss={() => setDismissedJob(job.startedAt)}
        />
      )}

      {sandboxes === null && !error && <p className="text-xs text-text-muted">Checking…</p>}

      {sandboxes?.length === 0 && !jobRunning && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-text-muted">No sandbox for this session yet.</p>
          <Button variant="primary" size="sm" onClick={up} disabled={busy !== null}>
            Start sandbox
          </Button>
          <p className="text-[11px] text-text-muted">
            Copies the project&apos;s sandboxer.yaml into the worktree if it has none, then runs{' '}
            <span className="font-mono">sandboxer up</span>. Progress shows here.
          </p>
        </div>
      )}

      {sandboxes?.map((sb) => {
        const links = Object.entries(sb.urls ?? {})
        const ready = links.filter(([label]) => sb.links?.[label] === 'ready').length
        return (
          <div key={`${sb.project}/${sb.slug}`} className="flex flex-col gap-3" data-testid="sandbox-card">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-text font-mono truncate">
                {sb.project}/{sb.slug}
              </span>
              <span className="text-[11px] flex items-center gap-1 shrink-0" style={{ color: stateColour(sb.state) }}>
                <Dot colour="currentColor" pulse={sb.state === 'starting'} />
                {sb.state}
              </span>
            </div>

            {links.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="text-[11px] text-text-muted" data-testid="sandbox-ready-count">
                  {ready} of {links.length} ready
                </p>
                {links.map(([label, url]) => {
                  const state = sb.links?.[label]
                  return (
                    <div key={label} className="flex items-center gap-1">
                      <button
                        onClick={() => void window.api.sandboxer.openUrl(url)}
                        className={`flex-1 min-w-0 text-left text-[11px] hover:bg-bg-tertiary rounded flex items-center gap-2 ${
                          state && state !== 'ready' ? 'opacity-60' : ''
                        }`}
                        style={{ padding: '3px 6px' }}
                        title={`${url} — ${state ? LINK_TEXT[state] : 'Checking…'}`}
                        data-link-state={state ?? 'unknown'}
                      >
                        <Dot colour={state ? LINK_COLOUR[state] : MUTED} pulse={state === 'starting'} />
                        <span className="text-text-muted shrink-0" style={{ width: 64 }}>
                          {label}
                        </span>
                        <span className="text-accent truncate">{url.replace(/^https?:\/\//, '')}</span>
                      </button>
                      {state === 'not-built' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="border border-border shrink-0"
                          style={{ padding: '1px 8px' }}
                          disabled={busy !== null || jobRunning}
                          onClick={() => void build(sb, label)}
                        >
                          Build
                        </Button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {sb.state === 'stopped' || sb.state === 'exited' ? (
                <Button size="sm" variant="ghost" className="border border-border" disabled={busy !== null}
                  onClick={() => void act('start', () => window.api.sandboxer.start(sb))}>
                  Start
                </Button>
              ) : (
                <Button size="sm" variant="ghost" className="border border-border" disabled={busy !== null}
                  onClick={() => void act('stop', () => window.api.sandboxer.stop(sb))}>
                  Stop
                </Button>
              )}
              <Button size="sm" variant="ghost" className="border border-border"
                onClick={() => void runInSessionTerminal(session, `sandboxer logs -f ${target(sb)}`)}>
                Logs
              </Button>
              <Button size="sm" variant="ghost" className="border border-border"
                onClick={() => void runInSessionTerminal(session, `sandboxer shell ${target(sb)}`)}>
                Shell
              </Button>
              <Button size="sm" variant="ghost" className="border border-border text-danger" disabled={busy !== null}
                onClick={destroy}>
                Destroy
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs text-text-muted" style={{ padding: 12 }}>
      {children}
    </div>
  )
}
