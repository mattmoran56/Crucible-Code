import React, { useCallback, useEffect, useState } from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import { useProjectStore } from '../../stores/projectStore'
import { useTerminalStore } from '../../stores/terminalStore'
import { useWorkspaceLayoutStore } from '../../stores/workspaceLayoutStore'
import { useToastStore } from '../../stores/toastStore'
import { Button } from '../ui'
import type { SandboxInfo, Session } from '../../../shared/types'

const POLL_MS = 10_000

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/** Run a sandboxer command in a new terminal tab of the session, so its output is visible. */
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

function stateColour(state: string): string {
  if (state === 'running') return 'var(--color-success, #3fb950)'
  if (state === 'degraded' || state === 'failed') return 'var(--color-danger, #f85149)'
  if (state === 'stopped' || state === 'exited') return 'var(--color-text-muted)'
  return 'var(--color-warning, #d29922)'
}

/**
 * Right-panel view of the active session's Sandboxer sandbox: its state and
 * URLs, and up / stop / start / logs / shell / destroy. Only polls while open,
 * and only for projects with Sandboxer turned on.
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
    if (!enabled || !worktreePath) return
    void refresh()
    const timer = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(timer)
  }, [enabled, worktreePath, refresh])

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

  const up = () =>
    act('up', async () => {
      await window.api.sandboxer.prepare(project.repoPath, session.worktreePath, project.sandboxer?.configPath)
      await runInSessionTerminal(session, 'sandboxer up')
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

      {sandboxes === null && !error && <p className="text-xs text-text-muted">Checking…</p>}

      {sandboxes?.length === 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-text-muted">No sandbox for this session yet.</p>
          <Button variant="primary" size="sm" onClick={up} disabled={busy !== null}>
            Start sandbox
          </Button>
          <p className="text-[11px] text-text-muted">
            Copies the project&apos;s sandboxer.yaml into the worktree if it has none, then runs{' '}
            <span className="font-mono">sandboxer up</span> in a terminal tab.
          </p>
        </div>
      )}

      {sandboxes?.map((sb) => (
        <div key={`${sb.project}/${sb.slug}`} className="flex flex-col gap-3" data-testid="sandbox-card">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-text font-mono truncate">
              {sb.project}/{sb.slug}
            </span>
            <span className="text-[11px] flex items-center gap-1 shrink-0" style={{ color: stateColour(sb.state) }}>
              <span style={{ width: 6, height: 6, borderRadius: 3, background: 'currentColor' }} />
              {sb.state}
            </span>
          </div>

          {sb.urls && Object.keys(sb.urls).length > 0 && (
            <div className="flex flex-col gap-1">
              {Object.entries(sb.urls).map(([label, url]) => (
                <button
                  key={label}
                  onClick={() => void window.api.sandboxer.openUrl(url)}
                  className="text-left text-[11px] hover:bg-bg-tertiary rounded flex gap-2"
                  style={{ padding: '3px 6px' }}
                  title={url}
                >
                  <span className="text-text-muted shrink-0" style={{ width: 64 }}>
                    {label}
                  </span>
                  <span className="text-accent truncate">{url.replace(/^https?:\/\//, '')}</span>
                </button>
              ))}
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
      ))}
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
