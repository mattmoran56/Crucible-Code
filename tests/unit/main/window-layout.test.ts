import { describe, expect, it } from 'vitest'
import {
  addProjectToWindow,
  closeWindow,
  containsPoint,
  moveProject,
  projectsOnlyIn,
  reconcileLayouts,
  removeProjectEverywhere,
  removeProjectFromWindow,
  setWindowTabs,
  tearOffBounds,
  type LayoutEntry,
} from '../../../src/main/services/window-layout'

const W = (id: string, projectIds: string[], activeProjectId: string | null = projectIds[0] ?? null): LayoutEntry => ({
  id,
  projectIds,
  activeProjectId,
})

let n = 0
const newId = () => `new-${++n}`

describe('reconcileLayouts', () => {
  it('opens one window with every project when nothing is saved', () => {
    const out = reconcileLayouts([], ['a', 'b', 'c'], newId)
    expect(out).toHaveLength(1)
    expect(out[0].projectIds).toEqual(['a', 'b', 'c'])
    expect(out[0].activeProjectId).toBe('a')
  })

  it('keeps saved windows and their tab order', () => {
    const out = reconcileLayouts([W('w1', ['b', 'a'], 'a'), W('w2', ['c'])], ['a', 'b', 'c'], newId)
    expect(out.map((w) => w.projectIds)).toEqual([['b', 'a'], ['c']])
    expect(out[0].activeProjectId).toBe('a')
  })

  it('drops deleted projects and windows left empty', () => {
    const out = reconcileLayouts([W('w1', ['a', 'gone']), W('w2', ['gone'])], ['a'], newId)
    expect(out).toEqual([W('w1', ['a'], 'a')])
  })

  it('puts projects no window shows into the first window', () => {
    const out = reconcileLayouts([W('w1', ['a']), W('w2', ['b'])], ['a', 'b', 'new'], newId)
    expect(out[0].projectIds).toEqual(['a', 'new'])
    expect(out[1].projectIds).toEqual(['b'])
  })

  it('allows the same project in two windows', () => {
    const out = reconcileLayouts([W('w1', ['a', 'b']), W('w2', ['a'])], ['a', 'b'], newId)
    expect(out.map((w) => w.projectIds)).toEqual([['a', 'b'], ['a']])
  })

  it('dedupes tabs within a window and fixes a stale active project', () => {
    const out = reconcileLayouts([W('w1', ['a', 'a', 'b'], 'gone')], ['a', 'b'], newId)
    expect(out[0].projectIds).toEqual(['a', 'b'])
    expect(out[0].activeProjectId).toBe('a')
  })

  it('keeps the first saved window (and its bounds) when every saved window is empty', () => {
    const bounds = { x: 1, y: 2, width: 900, height: 700 }
    const out = reconcileLayouts([{ ...W('w1', ['gone']), bounds }], ['a'], newId)
    expect(out).toEqual([{ id: 'w1', projectIds: ['a'], activeProjectId: 'a', bounds }])
  })

  it('returns one empty window when there are no projects', () => {
    const out = reconcileLayouts([], [], newId)
    expect(out).toHaveLength(1)
    expect(out[0].projectIds).toEqual([])
    expect(out[0].activeProjectId).toBeNull()
  })
})

describe('moveProject', () => {
  it('moves a tab into another window at an index and focuses it there', () => {
    const out = moveProject([W('w1', ['a', 'b'], 'b'), W('w2', ['c', 'd'])], 'b', 'w1', 'w2', 1)
    expect(out[0]).toEqual(W('w1', ['a'], 'a'))
    expect(out[1]).toEqual(W('w2', ['c', 'b', 'd'], 'b'))
  })

  it('appends when no index is given', () => {
    const out = moveProject([W('w1', ['a', 'b']), W('w2', ['c'])], 'a', 'w1', 'w2')
    expect(out[1].projectIds).toEqual(['c', 'a'])
  })

  it('does not duplicate a tab the target already has', () => {
    const out = moveProject([W('w1', ['a', 'b']), W('w2', ['a', 'c'])], 'a', 'w1', 'w2', 2)
    expect(out[0].projectIds).toEqual(['b'])
    expect(out[1].projectIds).toEqual(['c', 'a'])
  })

  it('reorders when source and target are the same window', () => {
    const out = moveProject([W('w1', ['a', 'b', 'c'])], 'a', 'w1', 'w1', 2)
    expect(out[0].projectIds).toEqual(['b', 'c', 'a'])
  })

  it('can leave the source window empty (the manager closes it)', () => {
    const out = moveProject([W('w1', ['a']), W('w2', ['b'])], 'a', 'w1', 'w2')
    expect(out[0]).toEqual(W('w1', [], null))
  })
})

describe('removeProjectFromWindow / removeProjectEverywhere', () => {
  it('activates the tab that slides into the closed active tab', () => {
    const out = removeProjectFromWindow([W('w1', ['a', 'b', 'c'], 'b')], 'w1', 'b')
    expect(out[0]).toEqual(W('w1', ['a', 'c'], 'c'))
  })

  it('activates the new last tab when the last tab closes', () => {
    const out = removeProjectFromWindow([W('w1', ['a', 'b'], 'b')], 'w1', 'b')
    expect(out[0].activeProjectId).toBe('a')
  })

  it('keeps the active tab when another tab closes', () => {
    const out = removeProjectFromWindow([W('w1', ['a', 'b', 'c'], 'a')], 'w1', 'c')
    expect(out[0].activeProjectId).toBe('a')
  })

  it('removes a deleted project from every window', () => {
    const out = removeProjectEverywhere([W('w1', ['a', 'b']), W('w2', ['a'])], 'a')
    expect(out.map((w) => w.projectIds)).toEqual([['b'], []])
  })
})

describe('addProjectToWindow / setWindowTabs', () => {
  it('adds and focuses a project', () => {
    const out = addProjectToWindow([W('w1', ['a'])], 'w1', 'b')
    expect(out[0]).toEqual(W('w1', ['a', 'b'], 'b'))
  })

  it('setWindowTabs dedupes and keeps a valid active project', () => {
    const out = setWindowTabs([W('w1', ['a'])], 'w1', ['b', 'a', 'b'], 'a')
    expect(out[0]).toEqual(W('w1', ['b', 'a'], 'a'))
  })

  it('setWindowTabs falls back to the first tab for an unknown active project', () => {
    const out = setWindowTabs([W('w1', ['a'])], 'w1', ['b', 'a'], 'zzz')
    expect(out[0].activeProjectId).toBe('b')
  })
})

describe('closing a window', () => {
  it('lists the projects only that window shows', () => {
    expect(projectsOnlyIn([W('w1', ['a', 'b']), W('w2', ['a'])], 'w1')).toEqual(['b'])
  })

  it('moves orphaned projects into the given window without stealing focus', () => {
    const out = closeWindow([W('w1', ['a', 'b']), W('w2', ['c'], 'c')], 'w1', 'w2')
    expect(out).toEqual([W('w2', ['c', 'a', 'b'], 'c')])
  })

  it('drops the window when everything it shows is open elsewhere', () => {
    const out = closeWindow([W('w1', ['a']), W('w2', ['a', 'c'])], 'w1', 'w2')
    expect(out).toEqual([W('w2', ['a', 'c'])])
  })
})

describe('geometry helpers', () => {
  it('containsPoint is inclusive of the top-left edge only', () => {
    const b = { x: 10, y: 10, width: 100, height: 50 }
    expect(containsPoint(b, { x: 10, y: 10 })).toBe(true)
    expect(containsPoint(b, { x: 109, y: 59 })).toBe(true)
    expect(containsPoint(b, { x: 110, y: 30 })).toBe(false)
    expect(containsPoint(b, { x: 50, y: 5 })).toBe(false)
  })

  it('tearOffBounds puts the window under the cursor', () => {
    const work = { x: 0, y: 25, width: 2000, height: 1400 }
    expect(tearOffBounds({ x: 800, y: 400 }, { width: 1400, height: 900 }, work)).toEqual({
      x: 600,
      y: 380,
      width: 1400,
      height: 900,
    })
  })

  it('tearOffBounds clamps to the work area and shrinks oversized windows', () => {
    const work = { x: 0, y: 25, width: 1000, height: 700 }
    expect(tearOffBounds({ x: 5, y: 0 }, { width: 1400, height: 900 }, work)).toEqual({
      x: 0,
      y: 25,
      width: 1000,
      height: 700,
    })
  })
})
