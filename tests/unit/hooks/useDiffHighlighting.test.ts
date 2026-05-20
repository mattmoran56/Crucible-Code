import { describe, expect, it } from 'vitest'
import { buildFullText } from '../../../src/renderer/hooks/useDiffHighlighting'

describe('buildFullText', () => {
  it('returns null when there is no content to highlight', () => {
    expect(buildFullText([], null, 'new')).toBe(null)
    expect(buildFullText([], null, 'old')).toBe(null)
  })

  it('builds the new-side text from add + context lines', () => {
    const out = buildFullText(
      [
        { type: 'context', content: 'a', oldLine: 1, newLine: 1 },
        { type: 'delete', content: 'old', oldLine: 2 },
        { type: 'add', content: 'b', newLine: 2 },
        { type: 'context', content: 'c', oldLine: 3, newLine: 3 },
      ],
      null,
      'new',
    )
    expect(out).not.toBeNull()
    expect(out!.text).toBe('a\nb\nc')
    // The display indices [0, 2, 3] map to text lines 1, 2, 3
    expect(out!.displayToLine.get(0)).toBe(1)
    expect(out!.displayToLine.get(2)).toBe(2)
    expect(out!.displayToLine.get(3)).toBe(3)
    // delete row (index 1) is NOT in the new-side map
    expect(out!.displayToLine.has(1)).toBe(false)
  })

  it('builds the old-side text from delete + context lines', () => {
    const out = buildFullText(
      [
        { type: 'context', content: 'a', oldLine: 1, newLine: 1 },
        { type: 'delete', content: 'old', oldLine: 2 },
        { type: 'add', content: 'b', newLine: 2 },
        { type: 'context', content: 'c', oldLine: 3, newLine: 3 },
      ],
      null,
      'old',
    )
    expect(out!.text).toBe('a\nold\nc')
    expect(out!.displayToLine.get(0)).toBe(1)
    expect(out!.displayToLine.get(1)).toBe(2)
    expect(out!.displayToLine.get(3)).toBe(3)
    expect(out!.displayToLine.has(2)).toBe(false)
  })

  it('fills gaps with blob lines so shiki has full-file context', () => {
    // Hunk shows only lines 3-4, but the blob has 5 lines total. The resulting
    // text should be 5 lines long with the blob filling 1, 2, and 5.
    const blob = ['file-l1', 'file-l2', 'old-3', 'old-4', 'file-l5']
    const out = buildFullText(
      [
        { type: 'context', content: 'kept-3', oldLine: 3, newLine: 3 },
        { type: 'add', content: 'added-4', newLine: 4 },
      ],
      blob,
      'new',
    )
    expect(out!.text.split('\n')).toEqual(['file-l1', 'file-l2', 'kept-3', 'added-4', 'file-l5'])
    expect(out!.displayToLine.get(0)).toBe(3)
    expect(out!.displayToLine.get(1)).toBe(4)
  })

  it('extends the text up to the highest line number even when blob is shorter', () => {
    const out = buildFullText(
      [{ type: 'add', content: 'new-5', newLine: 5 }],
      ['a', 'b'],
      'new',
    )
    // 5 lines total: blob[0], blob[1], '', '', 'new-5'
    expect(out!.text.split('\n')).toEqual(['a', 'b', '', '', 'new-5'])
    expect(out!.displayToLine.get(0)).toBe(5)
  })

  it('prefers the diff line content over the blob when they conflict (newer source)', () => {
    // The blob represents what is on disk; the diff content represents what is
    // being added in this patch — which may not match the blob yet if the
    // patch is pre-merge. Prefer the diff content.
    const out = buildFullText(
      [{ type: 'add', content: 'patched', newLine: 1 }],
      ['blob-was'],
      'new',
    )
    expect(out!.text).toBe('patched')
  })
})
