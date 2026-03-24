import { create } from 'zustand'

export type WorkspaceTab = 'agent' | 'git' | 'pr' | 'review'

export interface WorkspaceColumn {
  id: string
  tabs: WorkspaceTab[]
  activeTab: WorkspaceTab
  flex: number
}

let columnIdCounter = 0
function nextColumnId(): string {
  return `col-${++columnIdCounter}`
}

interface WorkspaceLayoutState {
  columns: WorkspaceColumn[]

  /** Reset to a single column with the given tabs */
  resetLayout: (tabs: WorkspaceTab[], activeTab?: WorkspaceTab) => void

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
}

export const useWorkspaceLayoutStore = create<WorkspaceLayoutState>((set, get) => ({
  columns: [],

  resetLayout: (tabs, activeTab) => {
    if (tabs.length === 0) {
      set({ columns: [] })
      return
    }
    set({
      columns: [
        { id: nextColumnId(), tabs, activeTab: activeTab ?? tabs[0], flex: 1 },
      ],
    })
  },

  splitRight: () => {
    const { columns } = get()
    const sourceIdx = columns.findIndex((c) => c.tabs.length > 1)
    if (sourceIdx === -1) return

    const sourceCol = columns[sourceIdx]
    const tabToMove = sourceCol.tabs.find((t) => t !== sourceCol.activeTab)
    if (!tabToMove) return

    // Reset all flex to 1 so new columns get equal width
    const newColumns = columns.map((c) =>
      c.id === sourceCol.id
        ? { ...c, tabs: c.tabs.filter((t) => t !== tabToMove), flex: 1 }
        : { ...c, flex: 1 }
    )
    newColumns.splice(sourceIdx + 1, 0, {
      id: nextColumnId(),
      tabs: [tabToMove],
      activeTab: tabToMove,
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

    // Remove empty columns
    newColumns = newColumns.filter((c) => c.tabs.length > 0)
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
    return get().columns.some((c) => c.tabs.length > 1)
  },
}))
