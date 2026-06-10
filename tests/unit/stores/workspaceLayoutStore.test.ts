import { beforeEach, describe, expect, it } from 'vitest'
import {
  getTabBaseType,
  getTabLabel,
  isDynamicTab,
  useWorkspaceLayoutStore,
  type WorkspaceTab,
} from '../../../src/renderer/stores/workspaceLayoutStore'

beforeEach(() => {
  useWorkspaceLayoutStore.setState({ columns: [], savedLayouts: {} })
})

describe('workspaceLayout helpers', () => {
  it('isDynamicTab detects agent: and terminal: prefixes', () => {
    expect(isDynamicTab('agent')).toBe(false)
    expect(isDynamicTab('git')).toBe(false)
    expect(isDynamicTab('agent:1' as WorkspaceTab)).toBe(true)
    expect(isDynamicTab('terminal:7' as WorkspaceTab)).toBe(true)
  })

  it('getTabBaseType strips the suffix', () => {
    expect(getTabBaseType('agent')).toBe('agent')
    expect(getTabBaseType('agent:3' as WorkspaceTab)).toBe('agent')
    expect(getTabBaseType('terminal:9' as WorkspaceTab)).toBe('terminal')
  })

  it('getTabLabel maps the well-known tabs', () => {
    expect(getTabLabel('agent')).toBe('Agent')
    expect(getTabLabel('git')).toBe('Worktree')
    expect(getTabLabel('pr')).toBe('PR')
    expect(getTabLabel('review')).toBe('Review')
    expect(getTabLabel('code')).toBe('Code')
    expect(getTabLabel('agent:5' as WorkspaceTab)).toBe('Agent 5')
    expect(getTabLabel('terminal:2' as WorkspaceTab)).toBe('Terminal 2')
  })
})

describe('workspaceLayoutStore.resetLayout', () => {
  it('builds a single column with the supplied tabs', () => {
    useWorkspaceLayoutStore.getState().resetLayout(['agent', 'git'], 'git')
    const cols = useWorkspaceLayoutStore.getState().columns
    expect(cols).toHaveLength(1)
    expect(cols[0].tabs).toEqual(['agent', 'git'])
    expect(cols[0].activeTab).toBe('git')
  })

  it('clears columns when tabs is empty', () => {
    useWorkspaceLayoutStore.setState({
      columns: [{ id: 'c1', tabs: ['agent'], activeTab: 'agent', flex: 1 }],
    })
    useWorkspaceLayoutStore.getState().resetLayout([])
    expect(useWorkspaceLayoutStore.getState().columns).toEqual([])
  })

  it('restores saved layout for a context, dropping unavailable core tabs', () => {
    useWorkspaceLayoutStore.setState({
      savedLayouts: {
        ctx1: [{ id: 'c1', tabs: ['agent', 'pr'], activeTab: 'pr', flex: 1 }],
      },
    })
    useWorkspaceLayoutStore.getState().resetLayout(['agent', 'git'], 'agent', 'ctx1')
    const cols = useWorkspaceLayoutStore.getState().columns
    expect(cols).toHaveLength(1)
    // pr was saved but not in availableTabs, so it should be dropped
    expect(cols[0].tabs).toEqual(['agent', 'git'])
  })
})

describe('workspaceLayoutStore.splitRight / closeColumn', () => {
  it('splitRight appends an empty column when there are existing columns', () => {
    useWorkspaceLayoutStore.getState().resetLayout(['agent', 'git'])
    useWorkspaceLayoutStore.getState().splitRight()
    expect(useWorkspaceLayoutStore.getState().columns).toHaveLength(2)
    expect(useWorkspaceLayoutStore.getState().columns[1].tabs).toEqual([])
  })

  it('splitRight is a no-op when there are no columns', () => {
    useWorkspaceLayoutStore.getState().splitRight()
    expect(useWorkspaceLayoutStore.getState().columns).toEqual([])
  })

  it('closeColumn merges tabs into the previous column', () => {
    useWorkspaceLayoutStore.setState({
      columns: [
        { id: 'c1', tabs: ['agent'], activeTab: 'agent', flex: 1 },
        { id: 'c2', tabs: ['pr', 'git'], activeTab: 'pr', flex: 1 },
      ],
    })
    useWorkspaceLayoutStore.getState().closeColumn('c2')
    const cols = useWorkspaceLayoutStore.getState().columns
    expect(cols).toHaveLength(1)
    expect(cols[0].tabs).toEqual(['agent', 'pr', 'git'])
  })

  it('closeColumn is a no-op when only one column remains', () => {
    useWorkspaceLayoutStore.setState({
      columns: [{ id: 'c1', tabs: ['agent'], activeTab: 'agent', flex: 1 }],
    })
    useWorkspaceLayoutStore.getState().closeColumn('c1')
    expect(useWorkspaceLayoutStore.getState().columns).toHaveLength(1)
  })
})

describe('workspaceLayoutStore.setActiveTab / setColumnFlex / reorderTab', () => {
  it('setActiveTab updates the active tab on the matching column only', () => {
    useWorkspaceLayoutStore.setState({
      columns: [
        { id: 'c1', tabs: ['agent', 'git'], activeTab: 'agent', flex: 1 },
        { id: 'c2', tabs: ['pr'], activeTab: 'pr', flex: 1 },
      ],
    })
    useWorkspaceLayoutStore.getState().setActiveTab('c1', 'git')
    const cols = useWorkspaceLayoutStore.getState().columns
    expect(cols[0].activeTab).toBe('git')
    expect(cols[1].activeTab).toBe('pr')
  })

  it('setColumnFlex updates flex value', () => {
    useWorkspaceLayoutStore.setState({
      columns: [{ id: 'c1', tabs: ['agent'], activeTab: 'agent', flex: 1 }],
    })
    useWorkspaceLayoutStore.getState().setColumnFlex('c1', 2.5)
    expect(useWorkspaceLayoutStore.getState().columns[0].flex).toBe(2.5)
  })

  it('reorderTab moves a tab to a new index', () => {
    useWorkspaceLayoutStore.setState({
      columns: [{ id: 'c1', tabs: ['agent', 'git', 'pr'], activeTab: 'agent', flex: 1 }],
    })
    useWorkspaceLayoutStore.getState().reorderTab('c1', 0, 2)
    expect(useWorkspaceLayoutStore.getState().columns[0].tabs).toEqual(['git', 'pr', 'agent'])
  })
})

describe('workspaceLayoutStore.addAvailableTab / removeAvailableTab', () => {
  it('addAvailableTab adds to the first column when not already present', () => {
    useWorkspaceLayoutStore.setState({
      columns: [{ id: 'c1', tabs: ['agent'], activeTab: 'agent', flex: 1 }],
    })
    useWorkspaceLayoutStore.getState().addAvailableTab('pr')
    expect(useWorkspaceLayoutStore.getState().columns[0].tabs).toEqual(['agent', 'pr'])
  })

  it('addAvailableTab is a no-op when the tab is already present somewhere', () => {
    useWorkspaceLayoutStore.setState({
      columns: [
        { id: 'c1', tabs: ['agent'], activeTab: 'agent', flex: 1 },
        { id: 'c2', tabs: ['pr'], activeTab: 'pr', flex: 1 },
      ],
    })
    useWorkspaceLayoutStore.getState().addAvailableTab('pr')
    expect(useWorkspaceLayoutStore.getState().columns[0].tabs).toEqual(['agent'])
  })

  it('removeAvailableTab removes from every column and prunes empty columns', () => {
    useWorkspaceLayoutStore.setState({
      columns: [
        { id: 'c1', tabs: ['pr'], activeTab: 'pr', flex: 1 },
        { id: 'c2', tabs: ['agent', 'pr'], activeTab: 'pr', flex: 1 },
      ],
    })
    useWorkspaceLayoutStore.getState().removeAvailableTab('pr')
    const cols = useWorkspaceLayoutStore.getState().columns
    expect(cols).toHaveLength(1)
    expect(cols[0].tabs).toEqual(['agent'])
  })
})

describe('workspaceLayoutStore.addDynamicTab / removeDynamicTab / getDynamicTabs', () => {
  it('addDynamicTab adds and activates a fresh agent: tab on the column', () => {
    useWorkspaceLayoutStore.setState({
      columns: [{ id: 'c1', tabs: ['agent'], activeTab: 'agent', flex: 1 }],
    })
    const tabId = useWorkspaceLayoutStore.getState().addDynamicTab('c1', 'agent')
    expect(tabId.startsWith('agent:')).toBe(true)
    const col = useWorkspaceLayoutStore.getState().columns[0]
    expect(col.tabs).toContain(tabId)
    expect(col.activeTab).toBe(tabId)
  })

  it('addDynamicTab uses the terminal: prefix for terminals', () => {
    useWorkspaceLayoutStore.setState({
      columns: [{ id: 'c1', tabs: ['agent'], activeTab: 'agent', flex: 1 }],
    })
    const tabId = useWorkspaceLayoutStore.getState().addDynamicTab('c1', 'terminal')
    expect(tabId.startsWith('terminal:')).toBe(true)
  })

  it('getDynamicTabs returns only the dynamic tabs across all columns', () => {
    useWorkspaceLayoutStore.setState({
      columns: [
        { id: 'c1', tabs: ['agent', 'agent:1' as WorkspaceTab], activeTab: 'agent', flex: 1 },
        { id: 'c2', tabs: ['terminal:1' as WorkspaceTab, 'pr'], activeTab: 'pr', flex: 1 },
      ],
    })
    expect(useWorkspaceLayoutStore.getState().getDynamicTabs()).toEqual(['agent:1', 'terminal:1'])
  })
})

describe('workspaceLayoutStore.saveLayout / canSplit', () => {
  it('saveLayout persists the current columns under the context id', () => {
    useWorkspaceLayoutStore.setState({
      columns: [{ id: 'c1', tabs: ['agent'], activeTab: 'agent', flex: 1 }],
    })
    useWorkspaceLayoutStore.getState().saveLayout('ctx1')
    expect(useWorkspaceLayoutStore.getState().savedLayouts.ctx1).toHaveLength(1)
  })

  it('canSplit is true when there is at least one column', () => {
    expect(useWorkspaceLayoutStore.getState().canSplit()).toBe(false)
    useWorkspaceLayoutStore.setState({
      columns: [{ id: 'c1', tabs: ['agent'], activeTab: 'agent', flex: 1 }],
    })
    expect(useWorkspaceLayoutStore.getState().canSplit()).toBe(true)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Extended coverage (appended).
// ───────────────────────────────────────────────────────────────────────────

describe('workspaceLayout helpers (edge cases)', () => {
  it('getTabLabel maps review-loop and echoes unknown tabs verbatim', () => {
    expect(getTabLabel('review-loop')).toBe('Review Loop')
    expect(getTabLabel('something-else' as WorkspaceTab)).toBe('something-else')
  })

  it('isDynamicTab is false for core tabs containing dashes', () => {
    expect(isDynamicTab('review-loop')).toBe(false)
  })

  it('getTabBaseType returns the full name when there is no colon', () => {
    expect(getTabBaseType('review-loop')).toBe('review-loop')
  })
})

describe('workspaceLayoutStore.resetLayout (saved layout restoration)', () => {
  it('appends newly available tabs missing from the saved layout to the first column', () => {
    useWorkspaceLayoutStore.setState({
      savedLayouts: {
        ctx1: [
          { id: 'c1', tabs: ['agent'], activeTab: 'agent', flex: 1 },
          { id: 'c2', tabs: ['git'], activeTab: 'git', flex: 1 },
        ],
      },
    })
    useWorkspaceLayoutStore.getState().resetLayout(['agent', 'git', 'pr'], 'agent', 'ctx1')
    const cols = useWorkspaceLayoutStore.getState().columns
    expect(cols[0].tabs).toEqual(['agent', 'pr'])
    expect(cols[1].tabs).toEqual(['git'])
  })

  it('keeps dynamic tabs from the saved layout even though they are not offered', () => {
    useWorkspaceLayoutStore.setState({
      savedLayouts: {
        ctx1: [{ id: 'c1', tabs: ['agent', 'terminal:3' as WorkspaceTab], activeTab: 'terminal:3' as WorkspaceTab, flex: 1 }],
      },
    })
    useWorkspaceLayoutStore.getState().resetLayout(['agent'], 'agent', 'ctx1')
    expect(useWorkspaceLayoutStore.getState().columns[0].tabs).toEqual(['agent', 'terminal:3'])
    expect(useWorkspaceLayoutStore.getState().columns[0].activeTab).toBe('terminal:3')
  })

  it('reassigns activeTab to the first surviving tab when the saved one was dropped', () => {
    useWorkspaceLayoutStore.setState({
      savedLayouts: {
        ctx1: [{ id: 'c1', tabs: ['pr', 'agent'], activeTab: 'pr', flex: 1 }],
      },
    })
    useWorkspaceLayoutStore.getState().resetLayout(['agent'], 'agent', 'ctx1')
    expect(useWorkspaceLayoutStore.getState().columns[0].activeTab).toBe('agent')
  })

  it('drops emptied columns from the restored layout', () => {
    useWorkspaceLayoutStore.setState({
      savedLayouts: {
        ctx1: [
          { id: 'c1', tabs: ['agent'], activeTab: 'agent', flex: 1 },
          { id: 'c2', tabs: ['pr'], activeTab: 'pr', flex: 1 },
        ],
      },
    })
    useWorkspaceLayoutStore.getState().resetLayout(['agent'], 'agent', 'ctx1')
    expect(useWorkspaceLayoutStore.getState().columns).toHaveLength(1)
  })

  it('repopulates the first saved column with missing tabs when none of its tabs survive', () => {
    useWorkspaceLayoutStore.setState({
      savedLayouts: {
        ctx1: [{ id: 'c-old', tabs: ['pr'], activeTab: 'pr', flex: 1 }],
      },
    })
    useWorkspaceLayoutStore.getState().resetLayout(['agent', 'git'], 'git', 'ctx1')
    const cols = useWorkspaceLayoutStore.getState().columns
    expect(cols).toHaveLength(1)
    expect(cols[0].tabs).toEqual(['agent', 'git'])
    // The saved column is restored (missing tabs are appended to column 0), so
    // activeTab falls back to the first tab — the explicit 'git' default is
    // only used on the fresh-column path.
    expect(cols[0].activeTab).toBe('agent')
    expect(cols[0].id).toBe('c-old')
  })

  it('ignores savedLayouts entirely when no contextId is supplied', () => {
    useWorkspaceLayoutStore.setState({
      savedLayouts: {
        ctx1: [{ id: 'cX', tabs: ['agent', 'pr'], activeTab: 'pr', flex: 1 }],
      },
    })
    useWorkspaceLayoutStore.getState().resetLayout(['agent'])
    expect(useWorkspaceLayoutStore.getState().columns[0].tabs).toEqual(['agent'])
  })

  it('defaults activeTab to the first tab when none is supplied', () => {
    useWorkspaceLayoutStore.getState().resetLayout(['git', 'agent'])
    expect(useWorkspaceLayoutStore.getState().columns[0].activeTab).toBe('git')
  })
})

describe('workspaceLayoutStore.splitRight / closeColumn (edges)', () => {
  it('splitRight resets every column flex back to 1', () => {
    useWorkspaceLayoutStore.setState({
      columns: [{ id: 'c1', tabs: ['agent'], activeTab: 'agent', flex: 3.5 }],
    })
    useWorkspaceLayoutStore.getState().splitRight()
    const cols = useWorkspaceLayoutStore.getState().columns
    expect(cols.map((c) => c.flex)).toEqual([1, 1])
  })

  it('closing the first column merges its tabs into the second', () => {
    useWorkspaceLayoutStore.setState({
      columns: [
        { id: 'c1', tabs: ['agent'], activeTab: 'agent', flex: 1 },
        { id: 'c2', tabs: ['git'], activeTab: 'git', flex: 1 },
      ],
    })
    useWorkspaceLayoutStore.getState().closeColumn('c1')
    const cols = useWorkspaceLayoutStore.getState().columns
    expect(cols).toHaveLength(1)
    expect(cols[0].id).toBe('c2')
    expect(cols[0].tabs).toEqual(['git', 'agent'])
  })

  it('closeColumn ignores unknown column ids', () => {
    useWorkspaceLayoutStore.setState({
      columns: [
        { id: 'c1', tabs: ['agent'], activeTab: 'agent', flex: 1 },
        { id: 'c2', tabs: ['git'], activeTab: 'git', flex: 1 },
      ],
    })
    useWorkspaceLayoutStore.getState().closeColumn('ghost')
    expect(useWorkspaceLayoutStore.getState().columns).toHaveLength(2)
  })
})

describe('workspaceLayoutStore.moveTab', () => {
  beforeEach(() => {
    useWorkspaceLayoutStore.setState({
      columns: [
        { id: 'c1', tabs: ['agent', 'git'], activeTab: 'agent', flex: 1 },
        { id: 'c2', tabs: ['pr'], activeTab: 'pr', flex: 1 },
      ],
    })
  })

  it('moves the tab, appends at the end by default and activates it in the target', () => {
    useWorkspaceLayoutStore.getState().moveTab('git', 'c1', 'c2')
    const cols = useWorkspaceLayoutStore.getState().columns
    expect(cols[0].tabs).toEqual(['agent'])
    expect(cols[1].tabs).toEqual(['pr', 'git'])
    expect(cols[1].activeTab).toBe('git')
  })

  it('inserts at the requested target index', () => {
    useWorkspaceLayoutStore.getState().moveTab('git', 'c1', 'c2', 0)
    expect(useWorkspaceLayoutStore.getState().columns[1].tabs).toEqual(['git', 'pr'])
  })

  it('reassigns the source activeTab when the active tab was moved away', () => {
    useWorkspaceLayoutStore.getState().moveTab('agent', 'c1', 'c2')
    expect(useWorkspaceLayoutStore.getState().columns[0].activeTab).toBe('git')
  })

  it('removes the source column when it becomes empty', () => {
    useWorkspaceLayoutStore.getState().moveTab('pr', 'c2', 'c1')
    const cols = useWorkspaceLayoutStore.getState().columns
    expect(cols).toHaveLength(1)
    expect(cols[0].id).toBe('c1')
    expect(cols[0].tabs).toEqual(['agent', 'git', 'pr'])
  })

  it('is a no-op when source and target are the same column', () => {
    useWorkspaceLayoutStore.getState().moveTab('agent', 'c1', 'c1', 1)
    expect(useWorkspaceLayoutStore.getState().columns[0].tabs).toEqual(['agent', 'git'])
  })

  it('is a no-op when either column id is unknown', () => {
    useWorkspaceLayoutStore.getState().moveTab('agent', 'c1', 'ghost')
    useWorkspaceLayoutStore.getState().moveTab('agent', 'ghost', 'c2')
    expect(useWorkspaceLayoutStore.getState().columns[0].tabs).toEqual(['agent', 'git'])
    expect(useWorkspaceLayoutStore.getState().columns[1].tabs).toEqual(['pr'])
  })
})

describe('workspaceLayoutStore misc edges', () => {
  it('reorderTab leaves other columns untouched', () => {
    useWorkspaceLayoutStore.setState({
      columns: [
        { id: 'c1', tabs: ['agent', 'git'], activeTab: 'agent', flex: 1 },
        { id: 'c2', tabs: ['pr', 'review'], activeTab: 'pr', flex: 1 },
      ],
    })
    useWorkspaceLayoutStore.getState().reorderTab('c2', 1, 0)
    const cols = useWorkspaceLayoutStore.getState().columns
    expect(cols[0].tabs).toEqual(['agent', 'git'])
    expect(cols[1].tabs).toEqual(['review', 'pr'])
  })

  it('addAvailableTab is a no-op when there are no columns', () => {
    useWorkspaceLayoutStore.getState().addAvailableTab('pr')
    expect(useWorkspaceLayoutStore.getState().columns).toEqual([])
  })

  it('removeAvailableTab reassigns activeTab when the removed tab was active', () => {
    useWorkspaceLayoutStore.setState({
      columns: [{ id: 'c1', tabs: ['agent', 'pr'], activeTab: 'pr', flex: 1 }],
    })
    useWorkspaceLayoutStore.getState().removeAvailableTab('pr')
    expect(useWorkspaceLayoutStore.getState().columns[0].activeTab).toBe('agent')
  })

  it('removeAvailableTab keeps activeTab when a different tab is removed', () => {
    useWorkspaceLayoutStore.setState({
      columns: [{ id: 'c1', tabs: ['agent', 'pr'], activeTab: 'agent', flex: 1 }],
    })
    useWorkspaceLayoutStore.getState().removeAvailableTab('pr')
    expect(useWorkspaceLayoutStore.getState().columns[0].activeTab).toBe('agent')
  })

  it('addDynamicTab produces unique, increasing ids across calls', () => {
    useWorkspaceLayoutStore.setState({
      columns: [{ id: 'c1', tabs: [], activeTab: undefined, flex: 1 }],
    })
    const a = useWorkspaceLayoutStore.getState().addDynamicTab('c1', 'agent')
    const b = useWorkspaceLayoutStore.getState().addDynamicTab('c1', 'agent')
    expect(a).not.toBe(b)
    expect(useWorkspaceLayoutStore.getState().columns[0].tabs).toEqual([a, b])
    expect(useWorkspaceLayoutStore.getState().columns[0].activeTab).toBe(b)
  })

  it('addDynamicTab only touches the matching column', () => {
    useWorkspaceLayoutStore.setState({
      columns: [
        { id: 'c1', tabs: ['agent'], activeTab: 'agent', flex: 1 },
        { id: 'c2', tabs: ['git'], activeTab: 'git', flex: 1 },
      ],
    })
    useWorkspaceLayoutStore.getState().addDynamicTab('c2', 'terminal')
    const cols = useWorkspaceLayoutStore.getState().columns
    expect(cols[0].tabs).toEqual(['agent'])
    expect(cols[1].tabs).toHaveLength(2)
  })

  it('removeDynamicTab prunes a column that only held that tab', () => {
    useWorkspaceLayoutStore.setState({
      columns: [
        { id: 'c1', tabs: ['agent'], activeTab: 'agent', flex: 1 },
        { id: 'c2', tabs: ['terminal:8' as WorkspaceTab], activeTab: 'terminal:8' as WorkspaceTab, flex: 1 },
      ],
    })
    useWorkspaceLayoutStore.getState().removeDynamicTab('terminal:8' as WorkspaceTab)
    const cols = useWorkspaceLayoutStore.getState().columns
    expect(cols).toHaveLength(1)
    expect(cols[0].id).toBe('c1')
  })

  it('removeDynamicTab reassigns activeTab in a surviving column', () => {
    useWorkspaceLayoutStore.setState({
      columns: [{ id: 'c1', tabs: ['agent', 'agent:4' as WorkspaceTab], activeTab: 'agent:4' as WorkspaceTab, flex: 1 }],
    })
    useWorkspaceLayoutStore.getState().removeDynamicTab('agent:4' as WorkspaceTab)
    expect(useWorkspaceLayoutStore.getState().columns[0].activeTab).toBe('agent')
  })

  it('getDynamicTabs returns an empty list when only core tabs exist', () => {
    useWorkspaceLayoutStore.setState({
      columns: [{ id: 'c1', tabs: ['agent', 'git'], activeTab: 'agent', flex: 1 }],
    })
    expect(useWorkspaceLayoutStore.getState().getDynamicTabs()).toEqual([])
  })

  it('saveLayout does nothing when there are no columns', () => {
    useWorkspaceLayoutStore.setState({ savedLayouts: { keep: [{ id: 'x', tabs: ['agent'], activeTab: 'agent', flex: 1 }] } })
    useWorkspaceLayoutStore.getState().saveLayout('ctx-new')
    expect(useWorkspaceLayoutStore.getState().savedLayouts['ctx-new']).toBeUndefined()
    expect(useWorkspaceLayoutStore.getState().savedLayouts.keep).toHaveLength(1)
  })

  it('saveLayout keeps previously saved contexts intact', () => {
    useWorkspaceLayoutStore.setState({
      columns: [{ id: 'c1', tabs: ['agent'], activeTab: 'agent', flex: 1 }],
      savedLayouts: { old: [{ id: 'cX', tabs: ['git'], activeTab: 'git', flex: 1 }] },
    })
    useWorkspaceLayoutStore.getState().saveLayout('fresh')
    const saved = useWorkspaceLayoutStore.getState().savedLayouts
    expect(Object.keys(saved).sort()).toEqual(['fresh', 'old'])
  })
})
