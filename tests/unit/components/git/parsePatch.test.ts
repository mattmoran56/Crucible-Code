import { describe, expect, it } from 'vitest'
import { parsePatch, buildDisplayLines } from '../../../../src/renderer/components/git/DiffViewer'

const SIMPLE_PATCH = `@@ -1,3 +1,4 @@
 import React from 'react'
+import { useState } from 'react'
 function App() {
-  return null
+  return <div />
 }`

describe('parsePatch', () => {
  it('parses hunk header into a hunk row with id 0', () => {
    const lines = parsePatch(SIMPLE_PATCH)
    const hunk = lines.find((l) => l.type === 'hunk')
    expect(hunk).toBeTruthy()
    expect(hunk!.hunkId).toBe(0)
    expect(hunk!.content).toBe('@@ -1,3 +1,4 @@')
  })

  it('numbers context lines using both old and new counters', () => {
    const lines = parsePatch(SIMPLE_PATCH)
    const contexts = lines.filter((l) => l.type === 'context')
    expect(contexts[0]).toMatchObject({
      content: "import React from 'react'",
      oldLine: 1,
      newLine: 1,
    })
    expect(contexts[1]).toMatchObject({
      content: 'function App() {',
      oldLine: 2,
      newLine: 3,
    })
  })

  it('numbers add lines using the new-side counter only', () => {
    const lines = parsePatch(SIMPLE_PATCH)
    const adds = lines.filter((l) => l.type === 'add')
    expect(adds.length).toBe(2)
    expect(adds[0].content).toBe("import { useState } from 'react'")
    expect(adds[0].newLine).toBe(2)
    expect(adds[0].oldLine).toBeUndefined()
    expect(adds[1].content).toBe('  return <div />')
    expect(adds[1].newLine).toBe(4)
    expect(adds[1].oldLine).toBeUndefined()
  })

  it('numbers delete lines using the old-side counter only', () => {
    const lines = parsePatch(SIMPLE_PATCH)
    const deletes = lines.filter((l) => l.type === 'delete')
    expect(deletes.length).toBe(1)
    expect(deletes[0].content).toBe('  return null')
    expect(deletes[0].oldLine).toBe(3)
    expect(deletes[0].newLine).toBeUndefined()
  })

  it('emits a tail expander after the last hunk', () => {
    const lines = parsePatch(SIMPLE_PATCH)
    const last = lines[lines.length - 1]
    expect(last.type).toBe('expander')
    expect(last.expander).toMatchObject({
      isTail: true,
      nextNewStart: null,
      prevNewEnd: 4,
      prevOldEnd: 3,
    })
  })

  it('emits a between-hunk expander when there is a gap', () => {
    const patch = `@@ -1,1 +1,1 @@
 line1
@@ -20,1 +20,1 @@
 line20`
    const lines = parsePatch(patch)
    const expanders = lines.filter((l) => l.type === 'expander')
    // One between, one tail
    expect(expanders.length).toBe(2)
    const between = expanders[0]
    expect(between.expander?.prevNewEnd).toBe(1)
    expect(between.expander?.nextNewStart).toBe(20)
    expect(between.expander?.isTail).toBeFalsy()
  })

  it('assigns sequential hunk ids across multiple hunks', () => {
    const patch = `@@ -1,1 +1,1 @@
 a
@@ -5,1 +5,1 @@
 b`
    const lines = parsePatch(patch)
    const hunks = lines.filter((l) => l.type === 'hunk')
    expect(hunks.map((h) => h.hunkId)).toEqual([0, 1])
  })
})

describe('buildDisplayLines', () => {
  it('drops lines whose hunk id is in collapsedHunks (but keeps the hunk row)', () => {
    const parsed = parsePatch(SIMPLE_PATCH)
    const out = buildDisplayLines(parsed, {
      expandedNewLines: undefined,
      blobLines: null,
      collapsedHunks: new Set([0]),
    })
    // Hunk row should remain, body lines should not
    expect(out.some((l) => l.type === 'hunk')).toBe(true)
    expect(out.some((l) => l.type === 'add')).toBe(false)
    expect(out.some((l) => l.type === 'delete')).toBe(false)
    expect(out.some((l) => l.type === 'context')).toBe(false)
  })

  it('keeps all lines when no hunks are collapsed', () => {
    const parsed = parsePatch(SIMPLE_PATCH)
    const out = buildDisplayLines(parsed, {
      expandedNewLines: undefined,
      blobLines: null,
      collapsedHunks: new Set(),
    })
    expect(out.filter((l) => l.type === 'add')).toHaveLength(2)
    expect(out.filter((l) => l.type === 'delete')).toHaveLength(1)
    expect(out.filter((l) => l.type === 'context')).toHaveLength(3)
  })

  it('splices blob lines into the diff when expandedNewLines includes them', () => {
    // Patch starts at new line 3, so lines 1-2 are above the hunk
    const patch = `@@ -3,1 +3,2 @@
 ctx
+added`
    const parsed = parsePatch(patch)
    const blob = ['blob-line-1', 'blob-line-2', 'ctx', 'added']
    const out = buildDisplayLines(parsed, {
      expandedNewLines: new Set([1, 2]),
      blobLines: blob,
      collapsedHunks: new Set(),
    })
    const expandedContexts = out.filter((l) => l.type === 'context' && (l.newLine === 1 || l.newLine === 2))
    expect(expandedContexts).toHaveLength(2)
    expect(expandedContexts[0]).toMatchObject({ newLine: 1, content: 'blob-line-1' })
    expect(expandedContexts[1]).toMatchObject({ newLine: 2, content: 'blob-line-2' })
  })

  it('keeps an expander for the range that has not been expanded yet', () => {
    const patch = `@@ -3,1 +3,1 @@
 ctx`
    const parsed = parsePatch(patch)
    const out = buildDisplayLines(parsed, {
      expandedNewLines: new Set([1]), // expand only line 1, leaving line 2 as expander
      blobLines: ['l1', 'l2', 'ctx'],
      collapsedHunks: new Set(),
    })
    const expandedCtx = out.filter((l) => l.type === 'context')
    expect(expandedCtx.some((l) => l.newLine === 1)).toBe(true)
    // line 2 is still a gap — expander remains
    const remainingExpander = out.find((l) => l.type === 'expander' && l.expander && l.expander.prevNewEnd === 1)
    expect(remainingExpander).toBeTruthy()
    expect(remainingExpander!.expander!.nextNewStart).toBe(3)
  })

  it('tail expander expands up to blob length', () => {
    const patch = `@@ -1,1 +1,1 @@
 only-line`
    const parsed = parsePatch(patch)
    const tailExpander = parsed[parsed.length - 1]
    expect(tailExpander.type).toBe('expander')
    expect(tailExpander.expander?.isTail).toBe(true)

    const out = buildDisplayLines(parsed, {
      expandedNewLines: new Set([2, 3]),
      blobLines: ['only-line', 'tail-1', 'tail-2'],
      collapsedHunks: new Set(),
    })
    const tails = out.filter((l) => l.type === 'context' && (l.newLine === 2 || l.newLine === 3))
    expect(tails.map((t) => t.content)).toEqual(['tail-1', 'tail-2'])
  })
})
