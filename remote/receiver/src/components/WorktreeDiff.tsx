import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/wsClient'
import { parsePatch, type DiffLine } from '@renderer/components/git/diff-parse'

interface FileDiff {
  filePath: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  insertions: number
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

const POLL_MS = 3000

export function WorktreeDiff({ worktreePath }: { worktreePath: string }) {
  const [files, setFiles] = useState<FileDiff[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [patch, setPatch] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Poll file list — surfaces both newly-changed files and live insertion/deletion counts.
  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      try {
        const list = (await api.git.workingFiles(worktreePath)) as FileDiff[]
        if (cancelled) return
        setFiles(list)
        setSelected((prev) => {
          if (prev && list.some((f) => f.filePath === prev)) return prev
          return list[0]?.filePath ?? null
        })
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
  }, [worktreePath])

  // Poll the diff for the selected file — picks up live edits without user action.
  useEffect(() => {
    if (!selected) {
      setPatch(null)
      return
    }
    let cancelled = false
    const refresh = async () => {
      try {
        const p = (await api.git.workingFileDiff(worktreePath, selected)) as string
        if (!cancelled) setPatch(p ?? '')
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
  }, [worktreePath, selected])

  const lines = useMemo<DiffLine[]>(() => (patch ? parsePatch(patch) : []), [patch])

  if (files == null) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-text-muted">
        Loading…
      </div>
    )
  }

  if (files.length === 0) {
    return (
      <div className="flex-1 flex flex-col">
        {error && <div className="text-xs text-danger px-3 py-1.5 bg-danger/10">{error}</div>}
        <div className="flex-1 flex items-center justify-center text-xs text-text-muted">
          No working changes
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col md:flex-row">
      {error && <div className="text-xs text-danger px-3 py-1.5 bg-danger/10">{error}</div>}

      {/* File list — horizontal strip on mobile, sidebar on md+. */}
      <div
        className={
          'shrink-0 overflow-auto bg-bg-secondary border-border ' +
          'border-b md:border-b-0 md:border-r ' +
          'md:w-64 max-h-40 md:max-h-none'
        }
      >
        {files.map((f) => {
          const isActive = f.filePath === selected
          return (
            <button
              key={f.filePath}
              onClick={() => setSelected(f.filePath)}
              className={
                'w-full text-left text-xs flex items-center gap-2 transition-colors ' +
                (isActive ? 'bg-accent/10 text-text' : 'text-text-muted hover:bg-bg-tertiary hover:text-text')
              }
              style={{ padding: '6px 12px' }}
              title={f.filePath}
            >
              <span className={`font-mono font-bold shrink-0 ${STATUS_COLORS[f.status] || ''}`}>
                {STATUS_LABELS[f.status] || '?'}
              </span>
              <span className="truncate flex-1">{f.filePath}</span>
              {(f.insertions > 0 || f.deletions > 0) && (
                <span className="ml-auto flex gap-1 text-[10px] shrink-0">
                  {f.insertions > 0 && <span className="text-success">+{f.insertions}</span>}
                  {f.deletions > 0 && <span className="text-danger">-{f.deletions}</span>}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Diff body — file path bar lives outside the scrollable region so it
          stays put while the user scrolls horizontally through long lines. */}
      <div className="flex-1 min-h-0 min-w-0 flex flex-col bg-bg">
        {selected && (
          <div
            className="bg-bg-tertiary border-b border-border text-xs text-text-muted truncate shrink-0"
            style={{ padding: '6px 12px' }}
            title={selected}
          >
            {selected}
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-auto">
          {patch == null ? (
            <div className="text-xs text-text-muted" style={{ padding: 24 }}>
              Loading diff…
            </div>
          ) : lines.length === 0 ? (
            <div className="text-xs text-text-muted" style={{ padding: 24 }}>
              No changes for this file.
            </div>
          ) : (
            <div className="font-mono text-xs">
              {lines.map((line, i) => (
                <DiffRow key={i} line={line} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function DiffRow({ line }: { line: DiffLine }) {
  if (line.type === 'expander') {
    // Static row — no on-demand context expansion in remote view.
    return <div className="border-y border-border bg-accent/5 text-[10px] text-text-muted px-3 py-1">···</div>
  }
  const bodyTint = ROW_BODY[line.type] ?? ''
  const gutterTint = ROW_GUTTER[line.type] ?? ''
  const indicatorTint = ROW_INDICATOR[line.type] ?? ''
  // Row grows to content width so the outer scroll container scrolls horizontally.
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
