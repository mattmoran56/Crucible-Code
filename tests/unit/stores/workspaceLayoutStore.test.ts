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
