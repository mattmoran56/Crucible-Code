import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useExpandableBlob } from '../../../../src/renderer/components/git/useExpandableBlob'
import { WORKING_CHANGES_HASH } from '../../../../src/renderer/stores/gitStore'

// Build the minimum window.api surface that the hook actually calls. Each test
// resets the spies so we can assert which IPC was used.
const fileRead = vi.fn<(filePath: string, rootPath: string) => Promise<string | null>>()
const gitShowFile = vi.fn<(repoPath: string, ref: string, filePath: string) => Promise<string | null>>()

beforeEach(() => {
  fileRead.mockReset()
  gitShowFile.mockReset()
  ;(window as any).api = {
    file: { read: fileRead },
    git: { showFile: gitShowFile },
  }
})

afterEach(() => {
  delete (window as any).api
})

const BLOB = `import React from 'react'\nexport default function App() {\n  return null\n}\n`

describe('useExpandableBlob', () => {
  it('does nothing if filePath or repoPath is missing', async () => {
    const { result } = renderHook(() =>
      useExpandableBlob({ repoPath: null, filePath: null, commitHash: null })
    )
    await act(async () => {
      await result.current.handleExpand('down', { prevOldEnd: 0, prevNewEnd: 0, nextOldStart: null, nextNewStart: null })
    })
    expect(fileRead).not.toHaveBeenCalled()
    expect(gitShowFile).not.toHaveBeenCalled()
    expect(result.current.blobLines).toBeNull()
    expect(result.current.expandedNewLines.size).toBe(0)
  })

  it('reads from the worktree when viewing WORKING_CHANGES', async () => {
    fileRead.mockResolvedValue(BLOB)
    const { result } = renderHook(() =>
      useExpandableBlob({
        repoPath: '/repo',
        filePath: 'src/App.tsx',
        commitHash: WORKING_CHANGES_HASH,
      })
    )
    await act(async () => {
      await result.current.handleExpand('down', {
        prevOldEnd: 0,
        prevNewEnd: 0,
        nextOldStart: null,
        nextNewStart: null,
        isTail: true,
      })
    })
    expect(fileRead).toHaveBeenCalledWith('src/App.tsx', '/repo')
    expect(gitShowFile).not.toHaveBeenCalled()
    expect(result.current.blobLines).toEqual([
      "import React from 'react'",
      'export default function App() {',
      '  return null',
      '}',
    ])
    expect([...result.current.expandedNewLines].sort((a, b) => a - b)).toEqual([1, 2, 3, 4])
  })

  it('uses git show when viewing a specific commit', async () => {
    gitShowFile.mockResolvedValue(BLOB)
    const { result } = renderHook(() =>
      useExpandableBlob({
        repoPath: '/repo',
        filePath: 'src/App.tsx',
        commitHash: 'abc123',
      })
    )
    await act(async () => {
      await result.current.handleExpand('down', {
        prevOldEnd: 0,
        prevNewEnd: 0,
        nextOldStart: null,
        nextNewStart: null,
        isTail: true,
      })
    })
    expect(gitShowFile).toHaveBeenCalledWith('/repo', 'abc123', 'src/App.tsx')
    expect(fileRead).not.toHaveBeenCalled()
  })

  it("caps the 'down' expansion at STEP=20 lines below prevNewEnd", async () => {
    const longBlob = Array.from({ length: 50 }, (_, i) => `line-${i + 1}`).join('\n')
    fileRead.mockResolvedValue(longBlob)
    const { result } = renderHook(() =>
      useExpandableBlob({
        repoPath: '/repo',
        filePath: 'src/App.tsx',
        commitHash: WORKING_CHANGES_HASH,
      })
    )
    await act(async () => {
      await result.current.handleExpand('down', {
        prevOldEnd: 5,
        prevNewEnd: 5,
        nextOldStart: null,
        nextNewStart: null,
        isTail: true,
      })
    })
    const expanded = [...result.current.expandedNewLines].sort((a, b) => a - b)
    expect(expanded).toEqual(Array.from({ length: 20 }, (_, i) => 6 + i))
  })

  it("the 'up' expansion targets the 20 lines immediately above nextNewStart", async () => {
    const longBlob = Array.from({ length: 50 }, (_, i) => `line-${i + 1}`).join('\n')
    fileRead.mockResolvedValue(longBlob)
    const { result } = renderHook(() =>
      useExpandableBlob({
        repoPath: '/repo',
        filePath: 'src/App.tsx',
        commitHash: WORKING_CHANGES_HASH,
      })
    )
    await act(async () => {
      await result.current.handleExpand('up', {
        prevOldEnd: 0,
        prevNewEnd: 0,
        nextOldStart: 40,
        nextNewStart: 40,
      })
    })
    // upper = 39, from = 39 - 20 + 1 = 20, to = 39
    const expanded = [...result.current.expandedNewLines].sort((a, b) => a - b)
    expect(expanded[0]).toBe(20)
    expect(expanded[expanded.length - 1]).toBe(39)
    expect(expanded.length).toBe(20)
  })

  it("'all' expands every line in the gap between two hunks", async () => {
    const longBlob = Array.from({ length: 50 }, (_, i) => `line-${i + 1}`).join('\n')
    fileRead.mockResolvedValue(longBlob)
    const { result } = renderHook(() =>
      useExpandableBlob({
        repoPath: '/repo',
        filePath: 'src/App.tsx',
        commitHash: WORKING_CHANGES_HASH,
      })
    )
    await act(async () => {
      await result.current.handleExpand('all', {
        prevOldEnd: 10,
        prevNewEnd: 10,
        nextOldStart: 25,
        nextNewStart: 25,
      })
    })
    const expanded = [...result.current.expandedNewLines].sort((a, b) => a - b)
    expect(expanded).toEqual(Array.from({ length: 14 }, (_, i) => 11 + i))
  })

  it('resets state when the file selection changes', async () => {
    fileRead.mockResolvedValue(BLOB)
    const { result, rerender } = renderHook(
      ({ filePath }) =>
        useExpandableBlob({
          repoPath: '/repo',
          filePath,
          commitHash: WORKING_CHANGES_HASH,
        }),
      { initialProps: { filePath: 'a.ts' } }
    )

    await act(async () => {
      await result.current.handleExpand('down', {
        prevOldEnd: 0,
        prevNewEnd: 0,
        nextOldStart: null,
        nextNewStart: null,
        isTail: true,
      })
    })
    expect(result.current.expandedNewLines.size).toBeGreaterThan(0)
    expect(result.current.blobLines).not.toBeNull()

    rerender({ filePath: 'b.ts' })
    expect(result.current.expandedNewLines.size).toBe(0)
    expect(result.current.blobLines).toBeNull()
  })

  it('only fetches the blob once across multiple expansions', async () => {
    fileRead.mockResolvedValue(BLOB)
    const { result } = renderHook(() =>
      useExpandableBlob({
        repoPath: '/repo',
        filePath: 'src/App.tsx',
        commitHash: WORKING_CHANGES_HASH,
      })
    )
    await act(async () => {
      await result.current.handleExpand('down', {
        prevOldEnd: 0,
        prevNewEnd: 0,
        nextOldStart: null,
        nextNewStart: null,
        isTail: true,
      })
    })
    await act(async () => {
      await result.current.handleExpand('down', {
        prevOldEnd: 1,
        prevNewEnd: 1,
        nextOldStart: null,
        nextNewStart: null,
        isTail: true,
      })
    })
    expect(fileRead).toHaveBeenCalledTimes(1)
  })
})
