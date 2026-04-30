import { create } from 'zustand'

const STORAGE_KEY = 'codecrucible-pr-view'

export type PRSortKey = 'number' | 'updated' | 'created'

export type PersonFilter =
  | { kind: 'anyone' }
  | { kind: 'me' }
  | { kind: 'login'; login: string }

export interface PRRepoView {
  sortBy: PRSortKey
  status: { ready: boolean; draft: boolean }
  assignee: PersonFilter
  author: PersonFilter
  reviewer: PersonFilter
  ci: { success: boolean; failure: boolean; pending: boolean; none: boolean }
  unseenOnly: boolean
}

export const DEFAULT_PR_VIEW: PRRepoView = {
  sortBy: 'number',
  status: { ready: true, draft: true },
  assignee: { kind: 'anyone' },
  author: { kind: 'anyone' },
  reviewer: { kind: 'anyone' },
  ci: { success: true, failure: true, pending: true, none: true },
  unseenOnly: false,
}

export function isDefaultView(view: PRRepoView): boolean {
  return (
    view.sortBy === DEFAULT_PR_VIEW.sortBy &&
    view.status.ready && view.status.draft &&
    view.assignee.kind === 'anyone' &&
    view.author.kind === 'anyone' &&
    view.reviewer.kind === 'anyone' &&
    view.ci.success && view.ci.failure && view.ci.pending && view.ci.none &&
    !view.unseenOnly
  )
}

interface PRViewState {
  byRepo: Record<string, PRRepoView>
  get: (repoPath: string) => PRRepoView
  patch: (repoPath: string, partial: Partial<PRRepoView>) => void
  reset: (repoPath: string) => void
}

function load(): Record<string, PRRepoView> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as Record<string, PRRepoView>
  } catch { /* ignore */ }
  return {}
}

function save(byRepo: Record<string, PRRepoView>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(byRepo))
  } catch { /* ignore */ }
}

export const usePRViewStore = create<PRViewState>((set, get) => ({
  byRepo: load(),

  get: (repoPath: string) => {
    return get().byRepo[repoPath] ?? DEFAULT_PR_VIEW
  },

  patch: (repoPath: string, partial: Partial<PRRepoView>) =>
    set((state) => {
      const current = state.byRepo[repoPath] ?? DEFAULT_PR_VIEW
      const next = { ...current, ...partial }
      const byRepo = { ...state.byRepo, [repoPath]: next }
      save(byRepo)
      return { byRepo }
    }),

  reset: (repoPath: string) =>
    set((state) => {
      const { [repoPath]: _removed, ...rest } = state.byRepo
      save(rest)
      return { byRepo: rest }
    }),
}))
