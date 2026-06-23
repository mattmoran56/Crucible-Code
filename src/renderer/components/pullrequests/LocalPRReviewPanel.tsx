import { useEffect, useMemo, useState } from 'react'
import { marked } from 'marked'
import type { LocalPR, PRFile } from '../../../shared/types'
import { Button } from '../ui/Button'

/**
 * Review view for a LOCAL PR — one that hasn't been promoted to GitHub yet, so
 * there's no `gh` data to fetch. Renders the stored title/body, any review-loop
 * findings, and the diff between the branch and its base from local git, plus a
 * Promote action. Used by PRReviewPanel when the active PR is local.
 */
export function LocalPRReviewPanel({ localPR }: { localPR: LocalPR }) {
  const [files, setFiles] = useState<PRFile[]>([])
  const [diff, setDiff] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [promoting, setPromoting] = useState(false)

  const repo = localPR.worktreePath
  const base = localPR.baseBranch

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    if (!repo) {
      setLoading(false)
      return
    }
    Promise.all([
      window.api.git.compareFiles(repo, base).catch(() => [] as PRFile[]),
      window.api.git.compareDiff(repo, base).catch(() => ''),
    ]).then(([f, d]) => {
      if (cancelled) return
      setFiles(f)
      setDiff(d)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [repo, base, localPR.updatedAt])

  const bodyHtml = useMemo(() => marked.parse(localPR.body || '_No description._') as string, [localPR.body])
  const findingsHtml = useMemo(
    () => (localPR.reviewFindings ? (marked.parse(localPR.reviewFindings) as string) : null),
    [localPR.reviewFindings]
  )

  const promoted = localPR.status === 'open' || localPR.status === 'merged' || !!localPR.realPrNumber

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div style={{ padding: '12px 14px' }}>
        {/* Header */}
        <div className="flex items-start gap-2">
          <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-warning/20 text-warning">
            Local
          </span>
          <div className="min-w-0">
            <div className="text-sm font-medium text-text break-words">{localPR.title}</div>
            <div className="text-[11px] text-text-muted mt-0.5">
              LOCAL-{localPR.localNumber} · {localPR.branch} &rarr; {base} · {localPR.status}
              {localPR.realPrNumber ? ` · published as #${localPR.realPrNumber}` : ''}
            </div>
          </div>
          <div className="ml-auto flex gap-1.5 shrink-0">
            {!promoted && (
              <Button
                size="sm"
                variant="primary"
                disabled={promoting}
                onClick={async () => {
                  setPromoting(true)
                  try {
                    await window.api.localPr.promote(localPR.id)
                  } finally {
                    setPromoting(false)
                  }
                }}
              >
                {promoting ? 'Promoting…' : 'Promote to PR'}
              </Button>
            )}
            {localPR.realPrUrl && promoted && (
              <a
                href={localPR.realPrUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-accent hover:underline self-center"
              >
                View on GitHub ↗
              </a>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="border border-border rounded mt-3">
          <div className="bg-bg-tertiary border-b border-border text-[11px] text-text-muted" style={{ padding: '5px 10px' }}>
            Description
          </div>
          <div className="markdown-body" style={{ padding: '8px 12px' }} dangerouslySetInnerHTML={{ __html: bodyHtml }} />
        </div>

        {/* Review-loop findings, if the loop ran on this local PR */}
        {findingsHtml && (
          <div className="border border-border rounded mt-3">
            <div className="bg-bg-tertiary border-b border-border text-[11px] text-text-muted" style={{ padding: '5px 10px' }}>
              Review loop findings
            </div>
            <div className="markdown-body" style={{ padding: '8px 12px' }} dangerouslySetInnerHTML={{ __html: findingsHtml }} />
          </div>
        )}

        {/* Changed files + diff (from local git, branch vs base) */}
        <div className="mt-3">
          <div className="text-[11px] text-text-muted mb-1.5">
            {loading ? 'Loading diff…' : `${files.length} file${files.length === 1 ? '' : 's'} changed (vs ${base})`}
          </div>
          {!loading && files.length > 0 && (
            <ul className="text-[11px] mb-2">
              {files.map((f) => (
                <li key={f.path} className="flex items-center gap-2 text-text-muted">
                  <span className="truncate">{f.path}</span>
                  <span className="ml-auto shrink-0">
                    <span className="text-success">+{f.additions}</span>{' '}
                    <span className="text-danger">-{f.deletions}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {!loading && diff && (
            <pre className="text-[11px] leading-snug overflow-x-auto border border-border rounded" style={{ padding: '8px 10px', margin: 0 }}>
              {diff.split('\n').map((line, i) => {
                const color = line.startsWith('+') && !line.startsWith('+++')
                  ? 'var(--color-success, #3fb950)'
                  : line.startsWith('-') && !line.startsWith('---')
                    ? 'var(--color-danger, #f85149)'
                    : line.startsWith('@@')
                      ? 'var(--color-accent, #58a6ff)'
                      : undefined
                return (
                  <div key={i} style={{ color }}>{line || ' '}</div>
                )
              })}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}
