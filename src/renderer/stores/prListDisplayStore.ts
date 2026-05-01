import { create } from 'zustand'
import { DEFAULT_PR_LIST_DISPLAY, displaysEqual, type PRListDisplay } from '../../shared/prDisplay'

const STORAGE_KEY = 'codecrucible-pr-list-display'

interface PersistedShape {
  default: PRListDisplay
  byRepo: Record<string, PRListDisplay>
}

interface PRListDisplayState {
  default: PRListDisplay
  byRepo: Record<string, PRListDisplay>
  getEffective: (repoPath: string) => PRListDisplay
  setDefault: (next: PRListDisplay) => void
  patchDefault: (partial: Partial<PRListDisplay>) => void
  setForRepo: (repoPath: string, next: PRListDisplay) => void
  patchForRepo: (repoPath: string, partial: Partial<PRListDisplay>) => void
  resetForRepo: (repoPath: string) => void
  hasOverride: (repoPath: string) => boolean
}

function load(): PersistedShape {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedShape>
      return {
        default: mergeWithDefault(parsed.default),
        byRepo: Object.fromEntries(
          Object.entries(parsed.byRepo ?? {}).map(([k, v]) => [k, mergeWithDefault(v)])
        ),
      }
    }
  } catch { /* ignore */ }
  return { default: DEFAULT_PR_LIST_DISPLAY, byRepo: {} }
}

function mergeWithDefault(value: PRListDisplay | undefined): PRListDisplay {
  if (!value) return DEFAULT_PR_LIST_DISPLAY
  return {
    fields: { ...DEFAULT_PR_LIST_DISPLAY.fields, ...(value.fields ?? {}) },
    labelFilter: value.labelFilter ?? { mode: 'all' },
  }
}

function save(state: PersistedShape) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch { /* ignore */ }
}

const initial = load()

export const usePRListDisplayStore = create<PRListDisplayState>((set, get) => ({
  default: initial.default,
  byRepo: initial.byRepo,

  getEffective: (repoPath: string) => {
    const state = get()
    return state.byRepo[repoPath] ?? state.default
  },

  setDefault: (next: PRListDisplay) =>
    set((state) => {
      const persisted = { default: next, byRepo: state.byRepo }
      save(persisted)
      return { default: next }
    }),

  patchDefault: (partial: Partial<PRListDisplay>) =>
    set((state) => {
      const next = { ...state.default, ...partial }
      const persisted = { default: next, byRepo: state.byRepo }
      save(persisted)
      return { default: next }
    }),

  setForRepo: (repoPath: string, next: PRListDisplay) =>
    set((state) => {
      const byRepo = { ...state.byRepo, [repoPath]: next }
      save({ default: state.default, byRepo })
      return { byRepo }
    }),

  patchForRepo: (repoPath: string, partial: Partial<PRListDisplay>) =>
    set((state) => {
      const current = state.byRepo[repoPath] ?? state.default
      const next = { ...current, ...partial }
      const byRepo = { ...state.byRepo, [repoPath]: next }
      save({ default: state.default, byRepo })
      return { byRepo }
    }),

  resetForRepo: (repoPath: string) =>
    set((state) => {
      if (!(repoPath in state.byRepo)) return state
      const { [repoPath]: _removed, ...rest } = state.byRepo
      save({ default: state.default, byRepo: rest })
      return { byRepo: rest }
    }),

  hasOverride: (repoPath: string) => {
    const state = get()
    const override = state.byRepo[repoPath]
    if (!override) return false
    return !displaysEqual(override, state.default)
  },
}))
