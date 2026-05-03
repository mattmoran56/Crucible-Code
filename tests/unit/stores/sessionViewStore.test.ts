import { beforeEach, describe, expect, it } from 'vitest'
import { useSessionViewStore } from '../../../src/renderer/stores/sessionViewStore'

const STORAGE_KEY = 'codecrucible-session-view'

beforeEach(() => {
  localStorage.clear()
  useSessionViewStore.setState({ sortBy: 'created', groupBy: 'none', collapsedGroups: {} })
})

describe('sessionViewStore', () => {
  it('exposes sane defaults', () => {
    expect(useSessionViewStore.getState().sortBy).toBe('created')
    expect(useSessionViewStore.getState().groupBy).toBe('none')
    expect(useSessionViewStore.getState().collapsedGroups).toEqual({})
  })

  it('setSortBy updates state and persists to localStorage', () => {
    useSessionViewStore.getState().setSortBy('name')
    expect(useSessionViewStore.getState().sortBy).toBe('name')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).sortBy).toBe('name')
  })

  it('setGroupBy updates state and persists', () => {
    useSessionViewStore.getState().setGroupBy('prStatus')
    expect(useSessionViewStore.getState().groupBy).toBe('prStatus')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).groupBy).toBe('prStatus')
  })

  it('toggleGroupCollapsed flips the boolean for a label', () => {
    useSessionViewStore.getState().toggleGroupCollapsed('Open PR')
    expect(useSessionViewStore.getState().collapsedGroups).toEqual({ 'Open PR': true })
    useSessionViewStore.getState().toggleGroupCollapsed('Open PR')
    expect(useSessionViewStore.getState().collapsedGroups).toEqual({ 'Open PR': false })
  })

  it('toggleGroupCollapsed independently tracks multiple groups', () => {
    useSessionViewStore.getState().toggleGroupCollapsed('Draft PR')
    useSessionViewStore.getState().toggleGroupCollapsed('Merged PR')
    expect(useSessionViewStore.getState().collapsedGroups).toEqual({
      'Draft PR': true,
      'Merged PR': true,
    })
  })
})
