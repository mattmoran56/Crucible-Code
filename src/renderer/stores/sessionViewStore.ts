import { create } from 'zustand'

const STORAGE_KEY = 'codecrucible-session-view'

export type SessionSortKey = 'created' | 'lastActive' | 'name'
export type SessionGroupKey = 'none' | 'prStatus'

interface SessionViewState {
  sortBy: SessionSortKey
  groupBy: SessionGroupKey
  setSortBy: (key: SessionSortKey) => void
  setGroupBy: (key: SessionGroupKey) => void
}

function load(): { sortBy: SessionSortKey; groupBy: SessionGroupKey } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return { sortBy: 'created', groupBy: 'none' }
}

function save(sortBy: SessionSortKey, groupBy: SessionGroupKey) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ sortBy, groupBy }))
}

export const useSessionViewStore = create<SessionViewState>((set) => {
  const initial = load()
  return {
    sortBy: initial.sortBy,
    groupBy: initial.groupBy,
    setSortBy: (sortBy) =>
      set((state) => {
        save(sortBy, state.groupBy)
        return { sortBy }
      }),
    setGroupBy: (groupBy) =>
      set((state) => {
        save(state.sortBy, groupBy)
        return { groupBy }
      }),
  }
})
