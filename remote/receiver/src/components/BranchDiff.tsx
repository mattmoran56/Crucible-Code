import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/wsClient'
import {
  parsePatch,
  splitPatchByFile,
  type DiffLine,
} from '@renderer/components/git/diff-parse'

interface Session {
  id: string
  worktreePath?: string
  baseBranch?: string
  viewedFiles?: string[]
}

interface PRFile {
  path: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  additions: number
  deletions: number
}

const STATUS_COLORS: Record<string, string> = {
  added: 'text-success',
  modified: 'text-warning',
  deleted: 'text-danger',
  renamed: 'text-accent',
}

const STATUS_LABELS: Record<string, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
}

const ROW_BODY: Record<string, string> = {
  header: 'bg-bg-tertiary text-text-muted',
  hunk: 'bg-accent/8 text-accent',
  context: '',
  add: 'bg-success/8',
  delete: 'bg-danger/8',
  expander: 'bg-bg-tertiary',
}

const ROW_GUTTER: Record<string, string> = {
  add: 'bg-success/15 text-success/70',
  delete: 'bg-danger/15 text-danger/70',
  context: 'text-text-muted/60',
  hunk: 'bg-accent/15 text-accent',
  header: 'text-text-muted/60',
  expander: '',
}

const ROW_INDICATOR: Record<string, string> = {
  add: 'bg-success/20 text-success',
  delete: 'bg-danger/20 text-danger',
  context: '',
  hunk: '',
  header: '',
  expander: '',
}

const INDICATOR_GLYPH: Record<string, string> = {
  add: '+',
  delete: '−',
}

const POLL_MS = 5000

export function BranchDiff({
  session,
  onUpdateSession,
}: {
  session: Session
  onUpdateSession: (s: Session) => void | Promise<void>
}) {
  const [baseBranch, setBaseBranch] = useState<string | null>(session.baseBranch ?? null)
  const [files, setFiles] = useState<PRFile[] | null>(null)
  const [patchesByFile, setPatchesByFile] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  const worktreePath = session.worktreePath
  const viewed = useMemo(() => new Set(session.viewedFiles ?? []), [session.viewedFiles])

  // Resolve base branch — fall back to the repo's default branch when the
  // session doesn't carry one.
  useEffect(() => {
    if (baseBranch || !worktreePath) return
    let cancelled = false
    api.git
      .defaultBranch(worktreePath)
      .then((b) => {
        if (cancelled) return
        if (typeof b === 'string' && b) setBaseBranch(b)
        else setBaseBranch('main')
      })
      .catch(() => {
        if (!cancelled) setBaseBranch('main')
      })
    return () => {
      cancelled = true
    }
  }, [worktreePath, baseBranch])

  // Poll file list + concatenated diff so the view reflects live edits.
  useEffect(() => {
    if (!worktreePath || !baseBranch) return
    let cancelled = false
    const refresh = async () => {
      try {
        const [list, fullDiff] = await Promise.all([
          api.git.compareFiles(worktreePath, baseBranch),
          api.git.compareDiff(worktreePath, baseBranch),
        ])
        if (cancelled) return
        const sortedFiles = ([...(list as PRFile[])] as PRFile[]).sort((a, b) =>
          a.path.localeCompare(b.path)
        )
        setFiles(sortedFiles)
        const split = splitPatchByFile(fullDiff as string)
        const map: Record<string, string> = {}
        for (const f of split) map[f.filePath] = f.patch
        setPatchesByFile(map)
        setError(null)
      } catch (e) {
        if (!cancelled) setError(String(e))
      }
    }
    void refresh()
    const id = window.setInterval(refresh, POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [worktreePath, baseBranch])

  const toggleViewed = (path: string) => {
    const next = new Set(viewed)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    void onUpdateSession({ ...session, viewedFiles: [...next] })
  }

  if (!worktreePath) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-text-muted">
        Session has no worktree.
      </div>
    )
  }

  if (files == null) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-text-muted">
        Loading branch diff…
      </div>
    )
  }

  const viewedCount = files.reduce((n, f) => (viewed.has(f.path) ? n + 1 : n), 0)

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Sticky summary bar — file count + base branch + viewed progress. */}
      <div
        className="bg-bg-tertiary border-b border-border text-xs text-text-muted flex items-center gap-3 shrink-0"
        style={{ padding: '6px 12px' }}
      >
        <span>
          <span className="text-text">{files.length}</span> file{files.length === 1 ? '' : 's'} vs{' '}
          <span className="text-text font-mono">{baseBranch ?? '…'}</span>
        </span>
        <span className="ml-auto">
          {viewedCount}/{files.length} viewed
        </span>
      </div>

      {error && <div className="text-xs text-danger px-3 py-1.5 bg-danger/10">{error}</div>}

      {files.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-xs text-text-muted">
          No differences against {baseBranch}.
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          {files.map((f) => (
            <FileSection
              key={f.path}
              file={f}
              patch={patchesByFile[f.path]}
              isViewed={viewed.has(f.path)}
              onToggleViewed={() => toggleViewed(f.path)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function FileSection({
  file,
  patch,
  isViewed,
  onToggleViewed,
}: {
  file: PRFile
  patch: string | undefined
  isViewed: boolean
  onToggleViewed: () => void
}) {
  const [collapsed, setCollapsed] = useState(false)

  // Auto-collapse when marked viewed; user can still expand manually.
  useEffect(() => {
    setCollapsed(isViewed)
  }, [isViewed])

  const lines = useMemo<DiffLine[]>(() => (patch ? parsePatch(patch) : []), [patch])

  return (
    <section className="border-b border-border">
      {/* Per-file header — sits above the horizontally-scrolling body. The
          outer container scrolls vertically so this header scrolls with the
          page; horizontal overflow is confined to the diff body. */}
      <header
        className="bg-bg-tertiary text-xs flex items-center gap-2 cursor-pointer hover:bg-bg-tertiary/80"
        style={{ padding: '8px 12px' }}
        onClick={() => setCollapsed((c) => !c)}
        title={collapsed ? 'Expand file' : 'Collapse file'}
      >
        <span className="text-text-muted select-none w-3 text-center" aria-hidden>
          {collapsed ? '▸' : '▾'}
        </span>
        <span className={`font-mono font-bold shrink-0 ${STATUS_COLORS[file.status] || ''}`}>
          {STATUS_LABELS[file.status] || '?'}
        </span>
        <span
          className={'truncate flex-1 ' + (isViewed ? 'text-text-muted line-through' : 'text-text')}
          title={file.path}
        >
          {file.path}
        </span>
        {(file.additions > 0 || file.deletions > 0) && (
          <span className="flex gap-1.5 text-[10px] shrink-0">
            {file.additions > 0 && <span className="text-success">+{file.additions}</span>}
            {file.deletions > 0 && <span className="text-danger">-{file.deletions}</span>}
          </span>
        )}
        <label
          className="flex items-center gap-1 text-[10px] text-text-muted shrink-0 cursor-pointer select-none"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            className="accent-accent"
            checked={isViewed}
            onChange={onToggleViewed}
          />
          Viewed
        </label>
      </header>

      {!collapsed && (
        <div className="overflow-x-auto bg-bg">
          {patch == null ? (
            <div className="text-xs text-text-muted" style={{ padding: 16 }}>
              Loading diff…
            </div>
          ) : lines.length === 0 ? (
            <div className="text-xs text-text-muted" style={{ padding: 16 }}>
              No textual diff (binary or rename only).
            </div>
          ) : (
            <div className="font-mono text-xs">
              {lines.map((line, i) => (
                <DiffRow key={i} line={line} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function DiffRow({ line }: { line: DiffLine }) {
  if (line.type === 'expander') {
    return <div className="border-y border-border bg-accent/5 text-[10px] text-text-muted px-3 py-1">···</div>
  }
  if (line.type === 'header') {
    // diff --git / index / +++ / --- lines — keep them, just less prominent.
    return (
      <div className="text-[10px] text-text-muted/70 px-3 py-0.5 whitespace-pre">
        {line.content}
      </div>
    )
  }
  const bodyTint = ROW_BODY[line.type] ?? ''
  const gutterTint = ROW_GUTTER[line.type] ?? ''
  const indicatorTint = ROW_INDICATOR[line.type] ?? ''
  return (
    <div className="flex leading-5 min-w-max">
      <span className={`flex shrink-0 ${gutterTint}`}>
        <span className="w-10 text-right select-none pr-2 tabular-nums">{line.oldLine ?? ''}</span>
        <span className="w-10 text-right select-none pr-2 tabular-nums border-r border-border/40">
          {line.newLine ?? ''}
        </span>
      </span>
      <span className={`w-5 text-center select-none shrink-0 ${indicatorTint}`}>
        {INDICATOR_GLYPH[line.type] || ''}
      </span>
      <pre className={`whitespace-pre pl-2 pr-4 ${bodyTint}`}>{line.content}</pre>
    </div>
  )
}
