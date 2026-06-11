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

describe('sessionViewStore persistence snapshots', () => {
  it('setSortBy persists the full snapshot including groupBy and collapsedGroups', () => {
    useSessionViewStore.setState({ groupBy: 'prStatus', collapsedGroups: { Merged: true } })
    useSessionViewStore.getState().setSortBy('name')
    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(persisted).toEqual({
      sortBy: 'name',
      groupBy: 'prStatus',
      collapsedGroups: { Merged: true },
    })
  })

  it('setGroupBy persists the current sortBy alongside the new grouping', () => {
    useSessionViewStore.setState({ sortBy: 'name' })
    useSessionViewStore.getState().setGroupBy('prStatus')
    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(persisted.sortBy).toBe('name')
    expect(persisted.groupBy).toBe('prStatus')
  })

  it('toggleGroupCollapsed persists the collapsedGroups map', () => {
    useSessionViewStore.getState().toggleGroupCollapsed('No PR')
    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(persisted.collapsedGroups).toEqual({ 'No PR': true })
  })

  it('each setter overwrites the previous snapshot rather than merging into it', () => {
    useSessionViewStore.getState().setSortBy('name')
    useSessionViewStore.getState().setGroupBy('prStatus')
    useSessionViewStore.getState().setSortBy('created')
    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(persisted).toEqual({ sortBy: 'created', groupBy: 'prStatus', collapsedGroups: {} })
  })
})

describe('sessionViewStore state interactions', () => {
  it('setSortBy back to created round-trips cleanly', () => {
    useSessionViewStore.getState().setSortBy('name')
    useSessionViewStore.getState().setSortBy('created')
    expect(useSessionViewStore.getState().sortBy).toBe('created')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).sortBy).toBe('created')
  })

  it('setGroupBy back to none round-trips cleanly', () => {
    useSessionViewStore.getState().setGroupBy('prStatus')
    useSessionViewStore.getState().setGroupBy('none')
    expect(useSessionViewStore.getState().groupBy).toBe('none')
  })

  it('toggling a pre-collapsed group records an explicit false (not a deletion)', () => {
    useSessionViewStore.setState({ collapsedGroups: { 'Open PR': true } })
    useSessionViewStore.getState().toggleGroupCollapsed('Open PR')
    expect(useSessionViewStore.getState().collapsedGroups).toEqual({ 'Open PR': false })
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).collapsedGroups).toEqual({
      'Open PR': false,
    })
  })

  it('toggling one group leaves an existing false entry for another untouched', () => {
    useSessionViewStore.setState({ collapsedGroups: { A: false } })
    useSessionViewStore.getState().toggleGroupCollapsed('B')
    expect(useSessionViewStore.getState().collapsedGroups).toEqual({ A: false, B: true })
  })

  it('changing the sort never clobbers in-memory collapsed groups', () => {
    useSessionViewStore.getState().toggleGroupCollapsed('Merged PR')
    useSessionViewStore.getState().setSortBy('name')
    expect(useSessionViewStore.getState().collapsedGroups).toEqual({ 'Merged PR': true })
  })

  it('changing the grouping never clobbers the sort order', () => {
    useSessionViewStore.getState().setSortBy('name')
    useSessionViewStore.getState().setGroupBy('prStatus')
    expect(useSessionViewStore.getState().sortBy).toBe('name')
  })
})
