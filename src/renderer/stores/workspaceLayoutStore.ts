import { create } from 'zustand'

export type CoreTab = 'agent' | 'git' | 'pr' | 'review' | 'code'
export type WorkspaceTab = CoreTab | `agent:${string}` | `terminal:${string}`

/** Check if a tab is a dynamic (closable) instance */
export function isDynamicTab(tab: WorkspaceTab): boolean {
  return tab.startsWith('agent:') || tab.startsWith('terminal:')
}

/** Get the base type of a tab ('agent', 'git', 'terminal', etc.) */
export function getTabBaseType(tab: WorkspaceTab): string {
  const idx = tab.indexOf(':')
  return idx === -1 ? tab : tab.slice(0, idx)
}

/** Get display label for a tab */
export function getTabLabel(tab: WorkspaceTab): string {
  if (tab === 'agent') return 'Agent'
  if (tab === 'git') return 'Worktree'
  if (tab === 'pr') return 'PR'
  if (tab === 'review') return 'Review'
  if (tab === 'code') return 'Code'
  if (tab.startsWith('agent:')) return `Agent ${tab.split(':')[1]}`
  if (tab.startsWith('terminal:')) return `Terminal ${tab.split(':')[1]}`
  return tab
}

export interface WorkspaceColumn {
  id: string
  tabs: WorkspaceTab[]
  activeTab: WorkspaceTab | undefined
  flex: number
}

let columnIdCounter = 0
function nextColumnId(): string {
  return `col-${++columnIdCounter}`
}

let dynamicAgentCounter = 1
let dynamicTerminalCounter = 0

interface WorkspaceLayoutState {
  columns: WorkspaceColumn[]

  /** Saved layouts keyed by session/context ID */
  savedLayouts: Record<string, WorkspaceColumn[]>

  /** Reset to a single column with the given tabs, or restore saved layout */
  resetLayout: (tabs: WorkspaceTab[], activeTab?: WorkspaceTab, contextId?: string) => void

  /** Save current layout for a context ID */
  saveLayout: (contextId: string) => void

  /** Split: pull a non-active tab from the first multi-tab column into a new column */
  splitRight: () => void

  /** Close a column, merging its tabs into the adjacent column */
  closeColumn: (columnId: string) => void

  /** Set the active tab within a column */
  setActiveTab: (columnId: string, tab: WorkspaceTab) => void

  /** Move a tab from one column to another */
  moveTab: (
    tab: WorkspaceTab,
    fromColumnId: string,
    toColumnId: string,
    targetIndex?: number
  ) => void

  /** Reorder a tab within a column */
  reorderTab: (columnId: string, fromIndex: number, toIndex: number) => void

  /** Update flex value for a column (used during resize) */
  setColumnFlex: (columnId: string, flex: number) => void

  /** Add a tab (e.g. PR becomes available) to the first column */
  addAvailableTab: (tab: WorkspaceTab) => void

  /** Remove a tab from all columns (e.g. PR closed) */
  removeAvailableTab: (tab: WorkspaceTab) => void

  /** Whether a split is possible (any column has >1 tab) */
  canSplit: () => boolean

  /** Add a dynamic agent or terminal tab to a column, returns the new tab ID */
  addDynamicTab: (columnId: string, type: 'agent' | 'terminal') => WorkspaceTab

  /** Remove a dynamic tab from all columns (and clean up empty columns) */
  removeDynamicTab: (tab: WorkspaceTab) => void

  /** Get all dynamic tabs currently in the layout */
  getDynamicTabs: () => WorkspaceTab[]
}

export const useWorkspaceLayoutStore = create<WorkspaceLayoutState>((set, get) => ({
  columns: [],
  savedLayouts: {},

  resetLayout: (tabs, activeTab, contextId) => {
    if (tabs.length === 0) {
      set({ columns: [] })
      return
    }

    // Try to restore a saved layout for this context
    if (contextId) {
      const saved = get().savedLayouts[contextId]
      if (saved && saved.length > 0) {
        // Validate saved layout: ensure all core tabs in saved layout are in the available tabs,
        // and add any new available tabs that weren't in the saved layout.
        // Dynamic tabs are always considered valid (they'll re-spawn their terminals).
        const availableSet = new Set(tabs)
        const savedTabs = new Set(saved.flatMap((c) => c.tabs))

        // Check if saved layout is still compatible (all saved core tabs still available)
        const allValid = [...savedTabs].every((t) => availableSet.has(t) || isDynamicTab(t))
        if (allValid) {
          // Add any new tabs that aren't in the saved layout to the first column
          const missingTabs = tabs.filter((t) => !savedTabs.has(t))
          const restored = saved.map((c, i) =>
            i === 0 && missingTabs.length > 0
              ? { ...c, tabs: [...c.tabs, ...missingTabs] }
              : c
          )
          set({ columns: restored })
          return
        }
      }
    }

    set({
      columns: [
        { id: nextColumnId(), tabs, activeTab: activeTab ?? tabs[0], flex: 1 },
      ],
    })
  },

  saveLayout: (contextId) => {
    const { columns, savedLayouts } = get()
    if (columns.length === 0) return
    set({
      savedLayouts: { ...savedLayouts, [contextId]: columns },
    })
  },

  splitRight: () => {
    const { columns } = get()
    if (columns.length === 0) return

    // Reset all flex to 1 so columns get equal width
    const newColumns = columns.map((c) => ({ ...c, flex: 1 }))
    newColumns.push({
      id: nextColumnId(),
      tabs: [],
      activeTab: undefined,
      flex: 1,
    })

    set({ columns: newColumns })
  },

  closeColumn: (columnId) => {
    const { columns } = get()
    if (columns.length <= 1) return

    const colIndex = columns.findIndex((c) => c.id === columnId)
    if (colIndex === -1) return

    const closingCol = columns[colIndex]
    const targetIndex = colIndex > 0 ? colIndex - 1 : 1
    const targetCol = columns[targetIndex]

    set({
      columns: columns
        .filter((c) => c.id !== columnId)
        .map((c) =>
          c.id === targetCol.id
            ? { ...c, tabs: [...c.tabs, ...closingCol.tabs] }
            : c
        ),
    })
  },

  setActiveTab: (columnId, tab) => {
    set({
      columns: get().columns.map((c) =>
        c.id === columnId ? { ...c, activeTab: tab } : c
      ),
    })
  },

  moveTab: (tab, fromColumnId, toColumnId, targetIndex) => {
    if (fromColumnId === toColumnId) return

    const { columns } = get()
    const fromCol = columns.find((c) => c.id === fromColumnId)
    const toCol = columns.find((c) => c.id === toColumnId)
    if (!fromCol || !toCol) return

    const newFromTabs = fromCol.tabs.filter((t) => t !== tab)
    const newToTabs = [...toCol.tabs]
    const insertAt = targetIndex ?? newToTabs.length
    newToTabs.splice(insertAt, 0, tab)

    let newColumns = columns.map((c) => {
      if (c.id === fromColumnId) {
        return {
          ...c,
          tabs: newFromTabs,
          activeTab: newFromTabs.includes(c.activeTab)
            ? c.activeTab
            : newFromTabs[0],
        }
      }
      if (c.id === toColumnId) {
        return { ...c, tabs: newToTabs, activeTab: tab }
      }
      return c
    })

    // Remove the source column if it became empty
    newColumns = newColumns.filter((c) => c.id !== fromColumnId || c.tabs.length > 0)
    set({ columns: newColumns })
  },

  reorderTab: (columnId, fromIndex, toIndex) => {
    set({
      columns: get().columns.map((c) => {
        if (c.id !== columnId) return c
        const tabs = [...c.tabs]
        const [moved] = tabs.splice(fromIndex, 1)
        tabs.splice(toIndex, 0, moved)
        return { ...c, tabs }
      }),
    })
  },

  setColumnFlex: (columnId, flex) => {
    set({
      columns: get().columns.map((c) =>
        c.id === columnId ? { ...c, flex } : c
      ),
    })
  },

  addAvailableTab: (tab) => {
    const { columns } = get()
    if (columns.length === 0) return
    const alreadyExists = columns.some((c) => c.tabs.includes(tab))
    if (alreadyExists) return

    set({
      columns: columns.map((c, i) =>
        i === 0 ? { ...c, tabs: [...c.tabs, tab] } : c
      ),
    })
  },

  removeAvailableTab: (tab) => {
    let newColumns = get().columns.map((c) => {
      const tabs = c.tabs.filter((t) => t !== tab)
      return {
        ...c,
        tabs,
        activeTab: tabs.includes(c.activeTab) ? c.activeTab : tabs[0],
      }
    })
    newColumns = newColumns.filter((c) => c.tabs.length > 0)
    set({ columns: newColumns })
  },

  canSplit: () => {
    return get().columns.length >= 1
  },

  addDynamicTab: (columnId, type) => {
    let tabId: WorkspaceTab
    if (type === 'agent') {
      tabId = `agent:${++dynamicAgentCounter}` as WorkspaceTab
    } else {
      tabId = `terminal:${++dynamicTerminalCounter}` as WorkspaceTab
    }

    set({
      columns: get().columns.map((c) =>
        c.id === columnId
          ? { ...c, tabs: [...c.tabs, tabId], activeTab: tabId }
          : c
      ),
    })

    return tabId
  },

  removeDynamicTab: (tab) => {
    let newColumns = get().columns.map((c) => {
      const tabs = c.tabs.filter((t) => t !== tab)
      return {
        ...c,
        tabs,
        activeTab: tabs.includes(c.activeTab) ? c.activeTab : tabs[0],
      }
    })
    newColumns = newColumns.filter((c) => c.tabs.length > 0)
    set({ columns: newColumns })
  },

  getDynamicTabs: () => {
    return get().columns.flatMap((c) => c.tabs.filter(isDynamicTab))
  },
}))
