import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  WORKING_CHANGES_HASH,
  getSavedBranchForSession,
  usePRPreviewStore,
} from '../../../src/renderer/stores/prPreviewStore'

const compareFiles = vi.fn()
const compareDiff = vi.fn()
const compareCommits = vi.fn()
const workingFilesPR = vi.fn()
const workingDiff = vi.fn()
const commitFullDiff = vi.fn()

beforeEach(() => {
  for (const fn of [compareFiles, compareDiff, compareCommits, workingFilesPR, workingDiff, commitFullDiff]) {
    fn.mockReset()
  }
  ;(window as any).api = {
    git: {
      compareFiles, compareDiff, compareCommits, workingFilesPR, workingDiff, commitFullDiff,
    },
  }
  localStorage.clear()
  usePRPreviewStore.setState({
    active: false,
    baseBranch: null,
    sessionId: null,
    files: [],
    fullDiff: null,
    workingDiff: null,
    workingFiles: [],
    commits: [],
    selectedFilePath: null,
    selectedCommitHash: null,
    commitDiff: null,
    viewMode: 'single',
    loading: false,
  })
})

const F = (path: string) => ({ path, status: 'modified', insertions: 1, deletions: 0 } as any)
const C = (hash: string) => ({ hash, message: hash, author: 'a', date: 'd' } as any)

describe('prPreviewStore.activate / setBaseBranch', () => {
  it('loads compare data and seeds the first selected file', async () => {
    compareFiles.mockResolvedValue([F('a.ts'), F('b.ts')])
    compareDiff.mockResolvedValue('@@DIFF@@')
    compareCommits.mockResolvedValue([C('h1')])
    workingFilesPR.mockResolvedValue([])
    workingDiff.mockResolvedValue('')

    await usePRPreviewStore.getState().activate('/repo', 'main', 's1')

    const s = usePRPreviewStore.getState()
    expect(s.active).toBe(true)
    expect(s.baseBranch).toBe('main')
    expect(s.files.map((f) => f.path)).toEqual(['a.ts', 'b.ts'])
    expect(s.fullDiff).toBe('@@DIFF@@')
    expect(s.commits).toHaveLength(1)
    expect(s.selectedFilePath).toBe('a.ts')
    expect(s.loading).toBe(false)
  })

  it('persists the chosen base branch under the sessionId', async () => {
    compareFiles.mockResolvedValue([])
    compareDiff.mockResolvedValue('')
    compareCommits.mockResolvedValue([])
    workingFilesPR.mockResolvedValue([])
    workingDiff.mockResolvedValue('')

    await usePRPreviewStore.getState().activate('/repo', 'develop', 'sess-7')
    expect(getSavedBranchForSession('sess-7')).toBe('develop')
  })

  it('merges working files on top of committed files (working wins on dup)', async () => {
    compareFiles.mockResolvedValue([F('a.ts'), F('b.ts')])
    compareDiff.mockResolvedValue('@@committed@@')
    compareCommits.mockResolvedValue([])
    workingFilesPR.mockResolvedValue([F('a.ts'), F('c.ts')])
    workingDiff.mockResolvedValue('@@working@@')

    await usePRPreviewStore.getState().activate('/repo', 'main')
    const s = usePRPreviewStore.getState()
    expect(s.files.map((f) => f.path)).toEqual(['a.ts', 'b.ts', 'c.ts'])
    expect(s.fullDiff).toBe('@@committed@@\n@@working@@')
    expect(s.workingDiff).toBe('@@working@@')
  })
})

describe('prPreviewStore.deactivate', () => {
  it('clears all state and removes the saved branch', async () => {
    compareFiles.mockResolvedValue([])
    compareDiff.mockResolvedValue('')
    compareCommits.mockResolvedValue([])
    workingFilesPR.mockResolvedValue([])
    workingDiff.mockResolvedValue('')

    await usePRPreviewStore.getState().activate('/repo', 'main', 's1')
    expect(getSavedBranchForSession('s1')).toBe('main')
    usePRPreviewStore.getState().deactivate('s1')
    expect(getSavedBranchForSession('s1')).toBeNull()
    const s = usePRPreviewStore.getState()
    expect(s.active).toBe(false)
    expect(s.baseBranch).toBeNull()
    expect(s.files).toEqual([])
  })
})

describe('prPreviewStore navigation', () => {
  beforeEach(() => {
    usePRPreviewStore.setState({
      files: [F('a.ts'), F('b.ts'), F('c.ts')],
      selectedFilePath: 'a.ts',
    })
  })

  it('selectFile sets the path', () => {
    usePRPreviewStore.getState().selectFile('b.ts')
    expect(usePRPreviewStore.getState().selectedFilePath).toBe('b.ts')
  })

  it('selectNextFile clamps at the end', () => {
    usePRPreviewStore.getState().selectFile('c.ts')
    usePRPreviewStore.getState().selectNextFile()
    expect(usePRPreviewStore.getState().selectedFilePath).toBe('c.ts')
  })

  it('selectPrevFile clamps at the start', () => {
    usePRPreviewStore.getState().selectFile('a.ts')
    usePRPreviewStore.getState().selectPrevFile()
    expect(usePRPreviewStore.getState().selectedFilePath).toBe('a.ts')
  })

  it('selectNextFile is a no-op when there are no files', () => {
    usePRPreviewStore.setState({ files: [], selectedFilePath: null })
    usePRPreviewStore.getState().selectNextFile()
    expect(usePRPreviewStore.getState().selectedFilePath).toBeNull()
  })
})

describe('prPreviewStore.selectCommit', () => {
  it('clears commit selection when hash is null and re-selects the first file', () => {
    usePRPreviewStore.setState({
      selectedCommitHash: 'abc',
      commitDiff: 'old',
      files: [F('a.ts')],
    })
    usePRPreviewStore.getState().selectCommit('/repo', null)
    const s = usePRPreviewStore.getState()
    expect(s.selectedCommitHash).toBeNull()
    expect(s.commitDiff).toBeNull()
    expect(s.selectedFilePath).toBe('a.ts')
  })

  it('uses the cached working diff for WORKING_CHANGES_HASH', async () => {
    usePRPreviewStore.setState({ workingDiff: '@@@working@@@' })
    await usePRPreviewStore.getState().selectCommit('/repo', WORKING_CHANGES_HASH)
    expect(commitFullDiff).not.toHaveBeenCalled()
    expect(usePRPreviewStore.getState().commitDiff).toBe('@@@working@@@')
  })

  it('fetches and stores the diff for a real hash', async () => {
    commitFullDiff.mockResolvedValue('@@commit@@')
    await usePRPreviewStore.getState().selectCommit('/repo', 'abc')
    expect(commitFullDiff).toHaveBeenCalledWith('/repo', 'abc')
    expect(usePRPreviewStore.getState().commitDiff).toBe('@@commit@@')
  })
})

describe('prPreviewStore.setViewMode', () => {
  it('toggles between single and scroll', () => {
    usePRPreviewStore.getState().setViewMode('scroll')
    expect(usePRPreviewStore.getState().viewMode).toBe('scroll')
    usePRPreviewStore.getState().setViewMode('single')
    expect(usePRPreviewStore.getState().viewMode).toBe('single')
  })
})

describe('prPreviewStore.nextCommit / prevCommit', () => {
  beforeEach(() => {
    usePRPreviewStore.setState({
      commits: [C('h1'), C('h2')],
      workingFiles: [F('a.ts')],
      selectedCommitHash: 'h1',
    })
    commitFullDiff.mockResolvedValue('@@@')
  })

  it('walks forward through hashes and ends at WORKING_CHANGES_HASH', async () => {
    await usePRPreviewStore.getState().nextCommit('/repo')
    expect(usePRPreviewStore.getState().selectedCommitHash).toBe('h2')
    await usePRPreviewStore.getState().nextCommit('/repo')
    expect(usePRPreviewStore.getState().selectedCommitHash).toBe(WORKING_CHANGES_HASH)
  })

  it('walks backward', async () => {
    usePRPreviewStore.setState({ selectedCommitHash: 'h2' })
    await usePRPreviewStore.getState().prevCommit('/repo')
    expect(usePRPreviewStore.getState().selectedCommitHash).toBe('h1')
  })

  it('clears selection when going prev from the first hash', async () => {
    usePRPreviewStore.setState({ selectedCommitHash: 'h1' })
    await usePRPreviewStore.getState().prevCommit('/repo')
    expect(usePRPreviewStore.getState().selectedCommitHash).toBeNull()
  })
})
