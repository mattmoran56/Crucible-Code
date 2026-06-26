import { create } from 'zustand'
import type { PRStack, PRStackEntryKind } from '../../shared/types'

interface PRStackState {
  // Per-project cache so toggling projects shows last-known state instantly.
  stacksCache: Record<string, PRStack[]>
  currentProjectId: string | null
  stacks: PRStack[]
  selectedStackId: string | null
  loading: boolean

  loadStacks: (projectId: string) => Promise<void>
  applyStackUpdate: (projectId: string, list: PRStack[]) => void
  selectStack: (id: string | null) => void

  createStack: (projectId: string, name: string, baseBranch: string) => Promise<PRStack | null>
  renameStack: (id: string, name: string) => Promise<void>
  deleteStack: (id: string) => Promise<void>
  addEntry: (
    stackId: string,
    input: { kind: PRStackEntryKind; localPrId?: string; prNumber?: number; branch?: string; baseBranch?: string }
  ) => Promise<void>
  removeEntry: (stackId: string, entryId: string) => Promise<void>
  reorder: (stackId: string, orderedEntryIds: string[]) => Promise<void>
  mergeStacks: (targetId: string, sourceId: string) => Promise<void>
  publish: (stackId: string) => Promise<void>
  restack: (stackId: string, mergedEntryId: string) => Promise<void>
  propagate: (stackId: string, sourceEntryId: string) => Promise<void>
  clear: () => void
}

export const usePRStackStore = create<PRStackState>((set, get) => ({
  stacksCache: {},
  currentProjectId: null,
  stacks: [],
  selectedStackId: null,
  loading: false,

  loadStacks: async (projectId: string) => {
    const cached = get().stacksCache[projectId]
    set({
      currentProjectId: projectId,
      stacks: cached ?? [],
      loading: !cached,
    })
    const fresh = await window.api.prStack.list(projectId)
    set((s) => ({ stacksCache: { ...s.stacksCache, [projectId]: fresh } }))
    if (get().currentProjectId === projectId) {
      set({ stacks: fresh, loading: false })
    }
  },

  applyStackUpdate: (projectId: string, list: PRStack[]) => {
    set((s) => ({ stacksCache: { ...s.stacksCache, [projectId]: list } }))
    if (get().currentProjectId === projectId) set({ stacks: list })
  },

  selectStack: (id: string | null) => set({ selectedStackId: id }),

  createStack: async (projectId, name, baseBranch) => {
    const stack = await window.api.prStack.create({ projectId, name, baseBranch })
    if (stack) set({ selectedStackId: stack.id })
    return stack
  },

  renameStack: async (id, name) => {
    await window.api.prStack.rename(id, name)
  },

  deleteStack: async (id) => {
    await window.api.prStack.delete(id)
    if (get().selectedStackId === id) set({ selectedStackId: null })
  },

  addEntry: async (stackId, input) => {
    await window.api.prStack.addEntry(stackId, input)
  },

  removeEntry: async (stackId, entryId) => {
    await window.api.prStack.removeEntry(stackId, entryId)
  },

  reorder: async (stackId, orderedEntryIds) => {
    // Optimistic: reorder locally so the drag feels instant; the push update
    // from main will reconcile (and recompute denormalized fields).
    set((s) => {
      const stacks = s.stacks.map((st) => {
        if (st.id !== stackId) return st
        const byId = new Map(st.entries.map((e) => [e.id, e]))
        const entries = orderedEntryIds
          .map((id, i) => {
            const e = byId.get(id)
            return e ? { ...e, order: i } : null
          })
          .filter((e): e is NonNullable<typeof e> => e !== null)
        return { ...st, entries }
      })
      return { stacks }
    })
    await window.api.prStack.reorder(stackId, orderedEntryIds)
  },

  mergeStacks: async (targetId, sourceId) => {
    await window.api.prStack.merge(targetId, sourceId)
    if (get().selectedStackId === sourceId) set({ selectedStackId: targetId })
  },

  publish: async (stackId) => {
    await window.api.prStack.publish(stackId)
  },

  restack: async (stackId, mergedEntryId) => {
    await window.api.prStack.restack(stackId, mergedEntryId)
  },

  propagate: async (stackId, sourceEntryId) => {
    await window.api.prStack.propagate(stackId, sourceEntryId)
  },

  clear: () => set({ stacks: [], selectedStackId: null, currentProjectId: null, loading: false }),
}))
