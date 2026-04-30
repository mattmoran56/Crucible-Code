import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { IconButton } from '../ui/IconButton'
import { usePRStore } from '../../stores/prStore'
import {
  usePRViewStore,
  isDefaultView,
  DEFAULT_PR_VIEW,
  type PRSortKey,
  type PersonFilter,
  type PRRepoView,
} from '../../stores/prViewStore'
import type { GitHubCollaborator } from '../../../shared/types'

interface Props {
  repoPath: string
}

type View = 'main' | 'assignee' | 'author' | 'reviewer'

const SORT_OPTIONS: { key: PRSortKey; label: string }[] = [
  { key: 'number', label: 'PR number' },
  { key: 'updated', label: 'Recently updated' },
  { key: 'created', label: 'Recently created' },
]

const PEOPLE_FILTERS: { key: 'assignee' | 'author' | 'reviewer'; label: string }[] = [
  { key: 'assignee', label: 'Assigned to' },
  { key: 'author', label: 'Created by' },
  { key: 'reviewer', label: 'Review requested' },
]

const CI_OPTIONS: { key: keyof PRRepoView['ci']; label: string }[] = [
  { key: 'success', label: 'Passing' },
  { key: 'failure', label: 'Failing' },
  { key: 'pending', label: 'Pending' },
  { key: 'none', label: 'No checks' },
]

function personFilterLabel(filter: PersonFilter, currentUser: string | null): string {
  if (filter.kind === 'anyone') return 'Anyone'
  if (filter.kind === 'me') return currentUser ? `Me (${currentUser})` : 'Me'
  return filter.login
}

export function PRSortFilterMenu({ repoPath }: Props) {
  const view = usePRViewStore((s) => s.byRepo[repoPath] ?? DEFAULT_PR_VIEW)
  const patch = usePRViewStore((s) => s.patch)
  const reset = usePRViewStore((s) => s.reset)

  const currentUser = usePRStore((s) => s.currentUser)
  const collaboratorsCache = usePRStore((s) => s.collaboratorsCache[repoPath])
  const loadCollaborators = usePRStore((s) => s.loadCollaborators)

  const [open, setOpen] = useState(false)
  const [subView, setSubView] = useState<View>('main')
  const [query, setQuery] = useState('')

  const triggerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  useEffect(() => {
    if (!open) return

    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      let top = rect.bottom + 2
      let left = rect.right

      if (menuRef.current) {
        const menuRect = menuRef.current.getBoundingClientRect()
        const vw = window.innerWidth
        const vh = window.innerHeight
        const menuLeft = left - menuRect.width
        if (menuLeft < 4) left = menuRect.width + 4
        if (left > vw - 4) left = vw - 4
        if (top + menuRect.height > vh - 4) top = rect.top - menuRect.height - 2
      }

      setPos({ top, left })
    }

    function handleClick(e: MouseEvent) {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (subView !== 'main') {
          setSubView('main')
          setQuery('')
        } else {
          setOpen(false)
        }
      }
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open, subView])

  // Reset to main view whenever the menu closes.
  useEffect(() => {
    if (!open) {
      setSubView('main')
      setQuery('')
    }
  }, [open])

  // Lazy-fetch collaborators the first time a person sub-view is opened.
  useEffect(() => {
    if (subView !== 'main' && !collaboratorsCache) {
      loadCollaborators(repoPath).catch(() => { /* ignore */ })
    }
  }, [subView, collaboratorsCache, loadCollaborators, repoPath])

  const isNonDefault = !isDefaultView(view)

  const setSort = (key: PRSortKey) => patch(repoPath, { sortBy: key })
  const setStatus = (key: keyof PRRepoView['status'], value: boolean) =>
    patch(repoPath, { status: { ...view.status, [key]: value } })
  const setCI = (key: keyof PRRepoView['ci'], value: boolean) =>
    patch(repoPath, { ci: { ...view.ci, [key]: value } })
  const setPerson = (key: 'assignee' | 'author' | 'reviewer', filter: PersonFilter) =>
    patch(repoPath, { [key]: filter } as Partial<PRRepoView>)

  return (
    <>
      <div ref={triggerRef} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}>
        <IconButton
          label="Sort & filter pull requests"
          className={`text-sm ${isNonDefault ? 'text-accent' : 'text-text-muted hover:text-text'}`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="4" y1="6" x2="16" y2="6" />
            <line x1="4" y1="12" x2="12" y2="12" />
            <line x1="4" y1="18" x2="8" y2="18" />
          </svg>
        </IconButton>
      </div>
      {open && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, transform: 'translateX(-100%)', zIndex: 9998, padding: '6px 4px', minWidth: 200 }}
          className="rounded border border-border bg-bg-secondary shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          {subView === 'main' ? (
            <MainView
              view={view}
              currentUser={currentUser}
              onSort={setSort}
              onStatus={setStatus}
              onCI={setCI}
              onUnseen={(v) => patch(repoPath, { unseenOnly: v })}
              onOpenPerson={(key) => setSubView(key)}
              isNonDefault={isNonDefault}
              onReset={() => reset(repoPath)}
            />
          ) : (
            <PersonView
              kind={subView}
              current={view[subView]}
              currentUser={currentUser}
              collaborators={collaboratorsCache ?? []}
              query={query}
              setQuery={setQuery}
              onPick={(filter) => {
                setPerson(subView, filter)
                setSubView('main')
                setQuery('')
              }}
              onBack={() => { setSubView('main'); setQuery('') }}
            />
          )}
        </div>,
        document.body
      )}
    </>
  )
}

interface MainViewProps {
  view: PRRepoView
  currentUser: string | null
  onSort: (key: PRSortKey) => void
  onStatus: (key: keyof PRRepoView['status'], value: boolean) => void
  onCI: (key: keyof PRRepoView['ci'], value: boolean) => void
  onUnseen: (value: boolean) => void
  onOpenPerson: (key: 'assignee' | 'author' | 'reviewer') => void
  isNonDefault: boolean
  onReset: () => void
}

function MainView({ view, currentUser, onSort, onStatus, onCI, onUnseen, onOpenPerson, isNonDefault, onReset }: MainViewProps) {
  return (
    <>
      <SectionHeader>Sort by</SectionHeader>
      {SORT_OPTIONS.map((opt) => (
        <Row
          key={opt.key}
          checked={view.sortBy === opt.key}
          onClick={() => onSort(opt.key)}
        >
          {opt.label}
        </Row>
      ))}

      <Divider />
      <SectionHeader>Status</SectionHeader>
      <Checkbox checked={view.status.ready} onChange={(v) => onStatus('ready', v)}>Ready</Checkbox>
      <Checkbox checked={view.status.draft} onChange={(v) => onStatus('draft', v)}>Draft</Checkbox>

      <Divider />
      <SectionHeader>People</SectionHeader>
      {PEOPLE_FILTERS.map((p) => (
        <PersonRow
          key={p.key}
          label={p.label}
          value={personFilterLabel(view[p.key], currentUser)}
          active={view[p.key].kind !== 'anyone'}
          onClick={() => onOpenPerson(p.key)}
        />
      ))}

      <Divider />
      <SectionHeader>CI status</SectionHeader>
      {CI_OPTIONS.map((opt) => (
        <Checkbox key={opt.key} checked={view.ci[opt.key]} onChange={(v) => onCI(opt.key, v)}>
          {opt.label}
        </Checkbox>
      ))}

      <Divider />
      <Checkbox checked={view.unseenOnly} onChange={onUnseen}>Unseen only</Checkbox>

      {isNonDefault && (
        <>
          <Divider />
          <button
            style={{ padding: '5px 10px' }}
            className="w-full text-left text-xs rounded text-text-muted hover:bg-bg-tertiary hover:text-text transition-colors"
            onClick={onReset}
          >
            Reset
          </button>
        </>
      )}
    </>
  )
}

interface PersonViewProps {
  kind: 'assignee' | 'author' | 'reviewer'
  current: PersonFilter
  currentUser: string | null
  collaborators: GitHubCollaborator[]
  query: string
  setQuery: (q: string) => void
  onPick: (filter: PersonFilter) => void
  onBack: () => void
}

function PersonView({ kind, current, currentUser, collaborators, query, setQuery, onPick, onBack }: PersonViewProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus() }, [])

  const title =
    kind === 'assignee' ? 'Assigned to'
    : kind === 'author' ? 'Created by'
    : 'Review requested'

  const filtered = useMemo(() => {
    const lower = query.trim().toLowerCase()
    const list = collaborators.filter((c) => !lower || c.login.toLowerCase().includes(lower))
    return list.slice(0, 50)
  }, [collaborators, query])

  const isCurrent = (filter: PersonFilter): boolean => {
    if (current.kind !== filter.kind) return false
    if (current.kind === 'login' && filter.kind === 'login') return current.login === filter.login
    return true
  }

  return (
    <>
      <button
        style={{ padding: '5px 10px' }}
        className="w-full text-left text-xs rounded text-text-muted hover:bg-bg-tertiary hover:text-text flex items-center gap-1.5"
        onClick={onBack}
      >
        <span>‹</span>
        <span className="font-medium">{title}</span>
      </button>
      <Divider />
      <Row checked={isCurrent({ kind: 'anyone' })} onClick={() => onPick({ kind: 'anyone' })}>
        Anyone
      </Row>
      {currentUser && (
        <Row checked={isCurrent({ kind: 'me' })} onClick={() => onPick({ kind: 'me' })}>
          Me ({currentUser})
        </Row>
      )}
      {collaborators.length > 0 && (
        <>
          <Divider />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter…"
            className="w-full bg-bg text-text text-xs border-b border-border focus:outline-none"
            style={{ padding: '6px 10px' }}
          />
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {filtered.length === 0 ? (
              <div className="text-[10px] text-text-muted" style={{ padding: '6px 10px' }}>
                No matching collaborators
              </div>
            ) : (
              filtered.map((c) => (
                <Row
                  key={c.login}
                  checked={isCurrent({ kind: 'login', login: c.login })}
                  onClick={() => onPick({ kind: 'login', login: c.login })}
                >
                  {c.login}
                </Row>
              ))
            )}
          </div>
        </>
      )}
    </>
  )
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] text-text-muted uppercase tracking-wide font-medium px-2.5 pt-1 pb-1.5">
      {children}
    </div>
  )
}

function Divider() {
  return <div className="border-t border-border my-1" />
}

interface RowProps {
  checked: boolean
  onClick: () => void
  children: React.ReactNode
}

function Row({ checked, onClick, children }: RowProps) {
  return (
    <button
      style={{ padding: '5px 10px', whiteSpace: 'nowrap' }}
      className={`w-full text-left text-xs rounded transition-colors flex items-center gap-2 ${
        checked ? 'text-accent' : 'text-text hover:bg-bg-tertiary'
      }`}
      onClick={onClick}
    >
      <span className="w-3 text-center">{checked ? '✓' : ''}</span>
      {children}
    </button>
  )
}

interface CheckboxProps {
  checked: boolean
  onChange: (value: boolean) => void
  children: React.ReactNode
}

function Checkbox({ checked, onChange, children }: CheckboxProps) {
  return (
    <button
      style={{ padding: '5px 10px', whiteSpace: 'nowrap' }}
      className="w-full text-left text-xs rounded transition-colors flex items-center gap-2 text-text hover:bg-bg-tertiary"
      onClick={() => onChange(!checked)}
    >
      <span
        className={`shrink-0 w-3 h-3 rounded-sm border flex items-center justify-center text-[9px] ${
          checked ? 'bg-accent border-accent text-bg' : 'border-border'
        }`}
      >
        {checked ? '✓' : ''}
      </span>
      {children}
    </button>
  )
}

interface PersonRowProps {
  label: string
  value: string
  active: boolean
  onClick: () => void
}

function PersonRow({ label, value, active, onClick }: PersonRowProps) {
  return (
    <button
      style={{ padding: '5px 10px', whiteSpace: 'nowrap' }}
      className="w-full text-left text-xs rounded transition-colors flex items-center gap-2 text-text hover:bg-bg-tertiary"
      onClick={onClick}
    >
      <span className="w-3 text-center" />
      <span className="flex-1">{label}</span>
      <span className={`text-[10px] ${active ? 'text-accent' : 'text-text-muted'}`}>{value}</span>
      <span className="text-text-muted">›</span>
    </button>
  )
}
