import React, { useEffect, useMemo, useState } from 'react'
import type { PRStack, PRStackEntry, PullRequest, LocalPR } from '../../../shared/types'
import { usePRStackStore } from '../../stores/prStackStore'
import { usePRStore } from '../../stores/prStore'
import { useProjectStore } from '../../stores/projectStore'
import { Button, IconButton, ListBox, ListItem, DropdownMenu } from '../ui'
import { CIIndicator } from './CIIndicator'

/** Normalized view of a stack entry with its referenced PR resolved. */
interface ResolvedEntry {
  entry: PRStackEntry
  label: string
  title: string
  branch: string
  base: string
  state: 'draft' | 'open' | 'merged'
  ciStatus: PullRequest['ciStatus']
  promoted: boolean
}

function resolveEntry(
  entry: PRStackEntry,
  localById: Map<string, LocalPR>,
  prByNumber: Map<number, PullRequest>
): ResolvedEntry {
  if (entry.kind === 'local') {
    const lpr = entry.localPrId ? localById.get(entry.localPrId) : undefined
    const promoted = !!lpr?.realPrNumber
    return {
      entry,
      label: promoted ? `#${lpr!.realPrNumber}` : lpr ? `LOCAL-${lpr.localNumber}` : 'LOCAL-?',
      title: lpr?.title ?? '(missing local PR)',
      branch: lpr?.branch ?? entry.branch ?? '',
      base: entry.baseBranch ?? lpr?.baseBranch ?? '',
      state: lpr?.status === 'merged' ? 'merged' : promoted ? 'open' : 'draft',
      ciStatus: lpr?.ciResult?.status ?? 'none',
      promoted,
    }
  }
  const pr = entry.prNumber ? prByNumber.get(entry.prNumber) : undefined
  return {
    entry,
    label: `#${entry.prNumber}`,
    title: pr?.title ?? '(PR not loaded)',
    branch: pr?.headRefName ?? entry.branch ?? '',
    base: pr?.baseRefName ?? entry.baseBranch ?? '',
    state: pr?.state === 'MERGED' ? 'merged' : pr?.isDraft ? 'draft' : 'open',
    ciStatus: pr?.ciStatus ?? 'none',
    promoted: true,
  }
}

function StateDot({ state }: { state: ResolvedEntry['state'] }) {
  return (
    <span
      title={state === 'merged' ? 'Merged' : state === 'draft' ? 'Draft / local' : 'Open'}
      className={`shrink-0 w-1.5 h-1.5 rounded-full ${
        state === 'merged' ? 'bg-merged' : state === 'draft' ? 'bg-text-muted' : 'bg-success'
      }`}
    />
  )
}

function StackList({
  stacks,
  onSelect,
  onNew,
  onDelete,
}: {
  stacks: PRStack[]
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
}) {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div
        className="flex items-center justify-between border-b border-border flex-shrink-0"
        style={{ padding: '6px 8px 6px 12px' }}
      >
        <span className="text-xs text-text-muted">
          {stacks.length} {stacks.length === 1 ? 'stack' : 'stacks'}
        </span>
        <IconButton label="New stack" onClick={onNew}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </IconButton>
      </div>
      {stacks.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-text-muted text-xs text-center">
            No stacks yet. Create one, or run a Foundry in local-PR mode.
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <ListBox label="PR stacks" onSelect={(i) => onSelect(stacks[i].id)}>
            {stacks.map((s) => {
              const pub = s.publish?.status
              const prop = s.propagation?.status
              const busy = pub === 'running' || prop === 'running' || prop === 'awaiting-conflict'
              const err = pub === 'error' || prop === 'error'
              return (
                <ListItem
                  key={s.id}
                  onClick={() => onSelect(s.id)}
                  style={{ padding: '7px 8px 7px 12px' }}
                  className="flex items-center gap-2 group"
                >
                  <span
                    className={`shrink-0 w-1.5 h-1.5 rounded-full ${
                      err ? 'bg-danger' : busy ? 'bg-warning' : 'bg-text-muted'
                    }`}
                  />
                  <span className="flex-1 text-sm text-text truncate min-w-0">{s.name}</span>
                  {s.foundryId && (
                    <span className="shrink-0 rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wide bg-accent/15 text-accent">
                      Foundry
                    </span>
                  )}
                  <span className="text-[10px] text-text-muted shrink-0">{s.entries.length}</span>
                  <div className="opacity-0 group-hover:opacity-100 flex-shrink-0">
                    <IconButton
                      label="Delete stack"
                      variant="danger"
                      onClick={(e) => {
                        e.stopPropagation()
                        onDelete(s.id)
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4h6v2" />
                      </svg>
                    </IconButton>
                  </div>
                </ListItem>
              )
            })}
          </ListBox>
        </div>
      )}
    </div>
  )
}

function StackDetail({ stack }: { stack: PRStack }) {
  const { selectStack, renameStack, removeEntry, reorder, addEntry } = usePRStackStore()
  const { localPRs, remotePRs } = usePRStore()
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(stack.name)

  const localById = useMemo(() => new Map(localPRs.map((l) => [l.id, l])), [localPRs])
  const prByNumber = useMemo(() => new Map(remotePRs.map((p) => [p.number, p])), [remotePRs])

  // Bottom-first entries (order 0 = base); display tip-first (reversed).
  const ordered = useMemo(() => [...stack.entries].sort((a, b) => a.order - b.order), [stack.entries])
  const resolved = ordered.map((e) => resolveEntry(e, localById, prByNumber))
  const tipFirst = [...resolved].reverse()

  // PRs not already in the stack, offered in the "Add PR" menu.
  const inStackLocal = new Set(stack.entries.filter((e) => e.kind === 'local').map((e) => e.localPrId))
  const inStackReal = new Set(stack.entries.filter((e) => e.kind === 'real').map((e) => e.prNumber))
  const addItems = [
    ...localPRs
      .filter((l) => l.status !== 'merged' && !inStackLocal.has(l.id) && !l.realPrNumber)
      .map((l) => ({
        label: `LOCAL-${l.localNumber}  ${l.title}`,
        onClick: () => addEntry(stack.id, { kind: 'local' as const, localPrId: l.id }),
      })),
    ...remotePRs
      .filter((p) => !p.isLocal && p.state === 'OPEN' && !inStackReal.has(p.number))
      .map((p) => ({
        label: `#${p.number}  ${p.title}`,
        onClick: () =>
          addEntry(stack.id, {
            kind: 'real' as const,
            prNumber: p.number,
            branch: p.headRefName,
            baseBranch: p.baseRefName,
          }),
      })),
  ]

  const commitName = () => {
    setEditingName(false)
    const next = nameDraft.trim()
    if (next && next !== stack.name) renameStack(stack.id, next)
    else setNameDraft(stack.name)
  }

  /** Reorder via native drag; `tipFirst` display order → bottom-first ids. */
  const onDrop = (targetDisplayId: string) => {
    if (!dragId || dragId === targetDisplayId) return
    const displayIds = tipFirst.map((r) => r.entry.id)
    const from = displayIds.indexOf(dragId)
    const to = displayIds.indexOf(targetDisplayId)
    if (from === -1 || to === -1) return
    const next = [...displayIds]
    next.splice(from, 1)
    next.splice(to, 0, dragId)
    // Convert display (tip-first) back to bottom-first for the service.
    reorder(stack.id, [...next].reverse())
    setDragId(null)
    setOverId(null)
  }

  const propLog = stack.propagation?.log ?? []
  const pubLog = stack.publish?.log ?? []
  const activeLog = (stack.propagation?.status && stack.propagation.status !== 'idle')
    ? propLog
    : pubLog

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div
        className="flex items-center gap-2 border-b border-border flex-shrink-0"
        style={{ padding: '6px 8px' }}
      >
        <IconButton label="Back to stacks" onClick={() => selectStack(null)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </IconButton>
        {editingName ? (
          <input
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName()
              if (e.key === 'Escape') { setEditingName(false); setNameDraft(stack.name) }
            }}
            className="flex-1 bg-bg-tertiary text-xs text-text rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-accent"
          />
        ) : (
          <button
            className="flex-1 text-left text-xs text-text truncate hover:text-accent"
            title="Rename stack"
            onClick={() => { setNameDraft(stack.name); setEditingName(true) }}
          >
            {stack.name}
          </button>
        )}
      </div>

      <div className="flex-shrink-0 border-b border-border" style={{ padding: '6px 8px' }}>
        <div className="text-[10px] text-text-muted mb-1.5 truncate" title={`Base: ${stack.baseBranch}`}>
          base&nbsp;→&nbsp;<span className="text-text">{stack.baseBranch}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <DropdownMenu items={addItems.length ? addItems : [{ label: 'No PRs available', onClick: () => {} }]}>
            <Button variant="ghost" className="text-[11px]">+ Add PR</Button>
          </DropdownMenu>
        </div>
      </div>

      {tipFirst.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-text-muted text-xs text-center">
            Empty stack. Add PRs from the menu above — they chain bottom-to-top.
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto" style={{ padding: '6px' }}>
          {tipFirst.map((r) => (
            <div
              key={r.entry.id}
              draggable
              onDragStart={() => setDragId(r.entry.id)}
              onDragOver={(e) => { e.preventDefault(); setOverId(r.entry.id) }}
              onDrop={() => onDrop(r.entry.id)}
              onDragEnd={() => { setDragId(null); setOverId(null) }}
              className={`group rounded border mb-1 cursor-grab active:cursor-grabbing ${
                overId === r.entry.id && dragId !== r.entry.id
                  ? 'border-accent bg-accent/10'
                  : 'border-border bg-bg-tertiary/40'
              }`}
              style={{ padding: '7px 8px' }}
            >
              <div className="flex items-center gap-1.5">
                <span className="shrink-0 text-text-muted/60" title="Drag to reorder">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>
                </span>
                <StateDot state={r.state} />
                <CIIndicator status={r.ciStatus} />
                <span className="text-[10px] font-medium text-text-muted shrink-0">{r.label}</span>
                <span className="text-xs text-text truncate flex-1 min-w-0">{r.title}</span>
                <div className="opacity-0 group-hover:opacity-100 shrink-0">
                  <IconButton
                    label="Remove from stack"
                    variant="danger"
                    onClick={(e) => { e.stopPropagation(); removeEntry(stack.id, r.entry.id) }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </IconButton>
                </div>
              </div>
              <div className="text-text-muted text-[10px] mt-1 truncate pl-[18px]">
                {r.branch} &rarr; {r.base}
              </div>
            </div>
          ))}
        </div>
      )}

      {activeLog.length > 0 && (
        <details className="flex-shrink-0 border-t border-border" style={{ padding: '6px 8px' }}>
          <summary className="text-[11px] uppercase tracking-wide text-text-muted cursor-pointer">
            Activity ({activeLog.length})
          </summary>
          <div
            className="mt-2 max-h-32 overflow-y-auto text-[10.5px] text-text-muted whitespace-pre-wrap"
            style={{ fontFamily: 'Menlo, Monaco, "Courier New", monospace' }}
          >
            {activeLog.slice(-50).join('\n')}
          </div>
        </details>
      )}
    </div>
  )
}

export function PRStacksPanel() {
  const { activeProjectId, projects } = useProjectStore()
  const { stacks, selectedStackId, loadStacks, selectStack, createStack, deleteStack } =
    usePRStackStore()
  const { loadLocalPRs, loadPRs } = usePRStore()

  const repoPath = projects.find((p) => p.id === activeProjectId)?.repoPath ?? null

  useEffect(() => {
    if (!activeProjectId) return
    loadStacks(activeProjectId)
    loadLocalPRs(activeProjectId)
    if (repoPath) loadPRs(repoPath)
  }, [activeProjectId, repoPath])

  if (!activeProjectId) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <p className="text-text-muted text-xs text-center">Select a project to manage PR stacks</p>
      </div>
    )
  }

  const handleNew = async () => {
    let baseBranch = 'main'
    if (repoPath) {
      try {
        baseBranch = await window.api.git.defaultBranch(repoPath)
      } catch {
        /* fall back to main */
      }
    }
    const n = stacks.length + 1
    await createStack(activeProjectId, `Stack ${n}`, baseBranch)
  }

  const selected = stacks.find((s) => s.id === selectedStackId) ?? null
  if (selected) return <StackDetail stack={selected} />

  return (
    <StackList
      stacks={stacks}
      onSelect={selectStack}
      onNew={handleNew}
      onDelete={deleteStack}
    />
  )
}
