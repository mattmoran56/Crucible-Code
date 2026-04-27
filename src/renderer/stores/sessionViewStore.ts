import { create } from 'zustand'

const STORAGE_KEY = 'codecrucible-session-view'

export type SessionSortKey = 'created' | 'name'
export type SessionGroupKey = 'none' | 'prStatus'

interface SessionViewState {
  sortBy: SessionSortKey
  groupBy: SessionGroupKey
  collapsedGroups: Record<string, boolean>
  setSortBy: (key: SessionSortKey) => void
  setGroupBy: (key: SessionGroupKey) => void
  toggleGroupCollapsed: (label: string) => void
}

interface Persisted {
  sortBy: SessionSortKey
  groupBy: SessionGroupKey
  collapsedGroups?: Record<string, boolean>
}

function load(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return { sortBy: 'created', groupBy: 'none', collapsedGroups: {} }
}

function save(state: Persisted) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export const useSessionViewStore = create<SessionViewState>((set) => {
  const initial = load()
  return {
    sortBy: initial.sortBy,
    groupBy: initial.groupBy,
    collapsedGroups: initial.collapsedGroups ?? {},
    setSortBy: (sortBy) =>
      set((state) => {
        save({ sortBy, groupBy: state.groupBy, collapsedGroups: state.collapsedGroups })
        return { sortBy }
      }),
    setGroupBy: (groupBy) =>
      set((state) => {
        save({ sortBy: state.sortBy, groupBy, collapsedGroups: state.collapsedGroups })
        return { groupBy }
      }),
    toggleGroupCollapsed: (label) =>
      set((state) => {
        const collapsedGroups = { ...state.collapsedGroups, [label]: !state.collapsedGroups[label] }
        save({ sortBy: state.sortBy, groupBy: state.groupBy, collapsedGroups })
        return { collapsedGroups }
      }),
  }
})
