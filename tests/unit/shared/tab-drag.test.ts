import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TAB_STRIP,
  detachedWindowPosition,
  findDropTarget,
  insertionIndex,
  placeAt,
  stripRect,
  type DragWindow,
} from '../../../src/shared/tab-drag'

const strip = DEFAULT_TAB_STRIP // left 78, top 0, height 44, tabWidth 176, slot 177

describe('insertionIndex', () => {
  it('picks the nearest slot for the dragged tab\'s left edge', () => {
    expect(insertionIndex(78, 3, strip)).toBe(0)
    expect(insertionIndex(78 + 88, 3, strip)).toBe(0) // just under half a slot
    expect(insertionIndex(78 + 89, 3, strip)).toBe(1)
    expect(insertionIndex(78 + 177 * 2, 3, strip)).toBe(2)
  })

  it('clamps to the strip', () => {
    expect(insertionIndex(-500, 3, strip)).toBe(0)
    expect(insertionIndex(5000, 3, strip)).toBe(3)
    expect(insertionIndex(5000, 0, strip)).toBe(0)
  })
})

describe('placeAt', () => {
  it('moves an item to an index in the list without it', () => {
    expect(placeAt(['a', 'b', 'c'], 'a', 2)).toEqual(['b', 'c', 'a'])
    expect(placeAt(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b'])
    expect(placeAt(['a', 'b'], 'x', 1)).toEqual(['a', 'x', 'b'])
    expect(placeAt(['a', 'b'], 'a', 9)).toEqual(['b', 'a'])
  })
})

describe('findDropTarget', () => {
  const w1: DragWindow = { id: 'w1', bounds: { x: 0, y: 100, width: 1000, height: 800 }, strip, tabCount: 2 }
  const w2: DragWindow = { id: 'w2', bounds: { x: 1200, y: 100, width: 1000, height: 800 }, strip, tabCount: 1 }

  it('stays in the attached window until the cursor leaves its strip by the margin', () => {
    // Grabbed 10px into the tab; cursor 30px below the strip — still attached.
    expect(findDropTarget({ x: 88 + 177, y: 100 + 44 + 30 }, 10, [w1, w2], 'w1')).toEqual({ windowId: 'w1', index: 1 })
    // 40px below: torn off.
    expect(findDropTarget({ x: 88, y: 100 + 44 + 40 }, 10, [w1, w2], 'w1')).toBeNull()
  })

  it('needs the cursor inside another window\'s strip to attach there', () => {
    expect(findDropTarget({ x: 1300, y: 100 + 44 + 10 }, 10, [w1, w2], null)).toBeNull()
    expect(findDropTarget({ x: 1200 + 78 + 177, y: 120 }, 0, [w1, w2], null)).toEqual({ windowId: 'w2', index: 1 })
    expect(findDropTarget({ x: 1200 + 20, y: 120 }, 0, [w1, w2], 'w1')).toEqual({ windowId: 'w2', index: 0 })
  })

  it('prefers the front-most window when strips overlap', () => {
    const behind: DragWindow = { ...w2, id: 'w3', bounds: { ...w2.bounds } }
    expect(findDropTarget({ x: 1300, y: 120 }, 0, [w2, behind], null)?.windowId).toBe('w2')
  })

  it('stripRect grows by the margin', () => {
    expect(stripRect(w1, { x: 5, y: 10 })).toEqual({ x: -5, y: 90, width: 1010, height: 64 })
  })
})

describe('detachedWindowPosition', () => {
  it('keeps the grab point under the cursor on the torn-off window\'s first tab', () => {
    expect(detachedWindowPosition({ x: 900, y: 500 }, { x: 30, y: 12 }, strip)).toEqual({ x: 900 - 78 - 30, y: 488 })
  })
})
