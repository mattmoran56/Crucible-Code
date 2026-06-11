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

// Appended coverage — error paths, refresh, persistence edge cases.
import { useToastStore } from '../../../src/renderer/stores/toastStore'

function mockHappyGit({
  committed = [] as any[],
  diff = '',
  commits = [] as any[],
  working = [] as any[],
  wDiff = '',
} = {}) {
  compareFiles.mockResolvedValue(committed)
  compareDiff.mockResolvedValue(diff)
  compareCommits.mockResolvedValue(commits)
  workingFilesPR.mockResolvedValue(working)
  workingDiff.mockResolvedValue(wDiff)
}

describe('prPreviewStore.setBaseBranch (extended)', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
  })

  it('clears stale data synchronously before the git calls resolve', async () => {
    usePRPreviewStore.setState({
      files: [F('stale.ts')],
      fullDiff: 'stale',
      selectedFilePath: 'stale.ts',
      selectedCommitHash: 'old',
      commitDiff: 'old-diff',
    })
    let resolveFiles: (v: any) => void = () => {}
    compareFiles.mockImplementation(() => new Promise((r) => { resolveFiles = r }))
    compareDiff.mockResolvedValue('')
    compareCommits.mockResolvedValue([])
    workingFilesPR.mockResolvedValue([])
    workingDiff.mockResolvedValue('')

    const p = usePRPreviewStore.getState().setBaseBranch('/repo', 'main')
    const mid = usePRPreviewStore.getState()
    expect(mid.files).toEqual([])
    expect(mid.fullDiff).toBeNull()
    expect(mid.selectedFilePath).toBeNull()
    expect(mid.selectedCommitHash).toBeNull()
    expect(mid.commitDiff).toBeNull()
    expect(mid.loading).toBe(true)
    resolveFiles([])
    await p
    expect(usePRPreviewStore.getState().loading).toBe(false)
  })

  it('leaves selectedFilePath null when there are no files at all', async () => {
    mockHappyGit()
    await usePRPreviewStore.getState().setBaseBranch('/repo', 'main')
    expect(usePRPreviewStore.getState().selectedFilePath).toBeNull()
  })

  it('uses only the working diff when the committed diff is empty', async () => {
    mockHappyGit({ working: [F('w.ts')], wDiff: '@@w@@' })
    await usePRPreviewStore.getState().setBaseBranch('/repo', 'main')
    expect(usePRPreviewStore.getState().fullDiff).toBe('@@w@@')
  })

  it('stores workingDiff as null when the working tree is clean', async () => {
    mockHappyGit({ committed: [F('a.ts')], diff: '@@c@@' })
    await usePRPreviewStore.getState().setBaseBranch('/repo', 'main')
    expect(usePRPreviewStore.getState().workingDiff).toBeNull()
    expect(usePRPreviewStore.getState().fullDiff).toBe('@@c@@')
  })

  it('toasts and stops loading when a git call rejects', async () => {
    compareFiles.mockRejectedValue(new Error('bad branch'))
    compareDiff.mockResolvedValue('')
    compareCommits.mockResolvedValue([])
    workingFilesPR.mockResolvedValue([])
    workingDiff.mockResolvedValue('')
    await usePRPreviewStore.getState().setBaseBranch('/repo', 'gone')
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: 'error', message: 'bad branch' })
    expect(usePRPreviewStore.getState().loading).toBe(false)
    expect(usePRPreviewStore.getState().files).toEqual([])
  })
})

describe('prPreviewStore branch persistence (extended)', () => {
  it('activate without a sessionId does not persist anything', async () => {
    mockHappyGit()
    await usePRPreviewStore.getState().activate('/repo', 'main')
    expect(localStorage.getItem('codecrucible-pr-preview-branches')).toBeNull()
  })

  it('deactivate without a sessionId keeps other sessions saved branches', async () => {
    mockHappyGit()
    await usePRPreviewStore.getState().activate('/repo', 'main', 's1')
    usePRPreviewStore.getState().deactivate()
    expect(getSavedBranchForSession('s1')).toBe('main')
  })

  it('getSavedBranchForSession survives corrupted localStorage', () => {
    localStorage.setItem('codecrucible-pr-preview-branches', '{{{not json')
    expect(getSavedBranchForSession('s1')).toBeNull()
  })

  it('setBaseBranch re-persists the branch for the active session', async () => {
    mockHappyGit()
    await usePRPreviewStore.getState().activate('/repo', 'main', 's1')
    await usePRPreviewStore.getState().setBaseBranch('/repo', 'develop')
    expect(getSavedBranchForSession('s1')).toBe('develop')
  })
})

describe('prPreviewStore navigation (extended)', () => {
  it('selectNextFile picks the first file when nothing is selected', () => {
    usePRPreviewStore.setState({ files: [F('a.ts'), F('b.ts')], selectedFilePath: null })
    usePRPreviewStore.getState().selectNextFile()
    expect(usePRPreviewStore.getState().selectedFilePath).toBe('a.ts')
  })

  it('selectPrevFile is a no-op when nothing is selected', () => {
    usePRPreviewStore.setState({ files: [F('a.ts')], selectedFilePath: null })
    usePRPreviewStore.getState().selectPrevFile()
    expect(usePRPreviewStore.getState().selectedFilePath).toBeNull()
  })

  it('selectCommit error path toasts and nulls commitDiff but keeps the hash', async () => {
    useToastStore.setState({ toasts: [] })
    commitFullDiff.mockRejectedValue(new Error('unknown sha'))
    await usePRPreviewStore.getState().selectCommit('/repo', 'deadbeef')
    const s = usePRPreviewStore.getState()
    expect(s.selectedCommitHash).toBe('deadbeef')
    expect(s.commitDiff).toBeNull()
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: 'error', message: 'unknown sha' })
  })

  it('selecting a real commit clears the file selection', async () => {
    usePRPreviewStore.setState({ selectedFilePath: 'a.ts' })
    commitFullDiff.mockResolvedValue('@@@')
    await usePRPreviewStore.getState().selectCommit('/repo', 'abc')
    expect(usePRPreviewStore.getState().selectedFilePath).toBeNull()
  })

  it('nextCommit with no commits and no working files is a no-op', async () => {
    usePRPreviewStore.setState({ commits: [], workingFiles: [], selectedCommitHash: null })
    await usePRPreviewStore.getState().nextCommit('/repo')
    expect(usePRPreviewStore.getState().selectedCommitHash).toBeNull()
  })

  it('nextCommit from no selection picks the first commit', async () => {
    usePRPreviewStore.setState({ commits: [C('h1'), C('h2')], workingFiles: [], selectedCommitHash: null })
    commitFullDiff.mockResolvedValue('@@@')
    await usePRPreviewStore.getState().nextCommit('/repo')
    expect(usePRPreviewStore.getState().selectedCommitHash).toBe('h1')
  })

  it('nextCommit clamps at the last commit when the working tree is clean', async () => {
    usePRPreviewStore.setState({ commits: [C('h1'), C('h2')], workingFiles: [], selectedCommitHash: 'h2' })
    await usePRPreviewStore.getState().nextCommit('/repo')
    expect(usePRPreviewStore.getState().selectedCommitHash).toBe('h2')
  })

  it('prevCommit from the working-changes entry returns to the last real commit', async () => {
    usePRPreviewStore.setState({
      commits: [C('h1'), C('h2')],
      workingFiles: [F('a.ts')],
      selectedCommitHash: WORKING_CHANGES_HASH,
    })
    commitFullDiff.mockResolvedValue('@@@')
    await usePRPreviewStore.getState().prevCommit('/repo')
    expect(usePRPreviewStore.getState().selectedCommitHash).toBe('h2')
  })

  it('prevCommit is a no-op when nothing is selected', async () => {
    usePRPreviewStore.setState({ commits: [C('h1')], workingFiles: [], selectedCommitHash: null })
    await usePRPreviewStore.getState().prevCommit('/repo')
    expect(usePRPreviewStore.getState().selectedCommitHash).toBeNull()
    expect(commitFullDiff).not.toHaveBeenCalled()
  })
})

describe('prPreviewStore.refresh', () => {
  it('is a no-op when no base branch is set', async () => {
    await usePRPreviewStore.getState().refresh('/repo')
    expect(compareFiles).not.toHaveBeenCalled()
  })

  it('preserves the selected file when it survives the refresh', async () => {
    usePRPreviewStore.setState({ baseBranch: 'main', selectedFilePath: 'b.ts' })
    mockHappyGit({ committed: [F('a.ts'), F('b.ts')] })
    await usePRPreviewStore.getState().refresh('/repo')
    expect(usePRPreviewStore.getState().selectedFilePath).toBe('b.ts')
    expect(usePRPreviewStore.getState().refreshing).toBe(false)
  })

  it('falls back to the first file when the selection disappeared', async () => {
    usePRPreviewStore.setState({ baseBranch: 'main', selectedFilePath: 'gone.ts' })
    mockHappyGit({ committed: [F('a.ts')] })
    await usePRPreviewStore.getState().refresh('/repo')
    expect(usePRPreviewStore.getState().selectedFilePath).toBe('a.ts')
  })

  it('sets refreshing while the fetch is in flight', async () => {
    usePRPreviewStore.setState({ baseBranch: 'main' })
    let resolveFiles: (v: any) => void = () => {}
    compareFiles.mockImplementation(() => new Promise((r) => { resolveFiles = r }))
    compareDiff.mockResolvedValue('')
    compareCommits.mockResolvedValue([])
    workingFilesPR.mockResolvedValue([])
    workingDiff.mockResolvedValue('')
    const p = usePRPreviewStore.getState().refresh('/repo')
    expect(usePRPreviewStore.getState().refreshing).toBe(true)
    resolveFiles([])
    await p
    expect(usePRPreviewStore.getState().refreshing).toBe(false)
  })

  it('refreshes the working-changes diff when that pseudo-commit is selected', async () => {
    usePRPreviewStore.setState({
      baseBranch: 'main',
      selectedCommitHash: WORKING_CHANGES_HASH,
      commitDiff: '@@stale@@',
    })
    mockHappyGit({ working: [F('w.ts')], wDiff: '@@fresh@@' })
    await usePRPreviewStore.getState().refresh('/repo')
    expect(usePRPreviewStore.getState().commitDiff).toBe('@@fresh@@')
  })

  it('keeps the commit diff untouched when a real commit is selected', async () => {
    usePRPreviewStore.setState({
      baseBranch: 'main',
      selectedCommitHash: 'abc',
      commitDiff: '@@commit-abc@@',
    })
    mockHappyGit({ wDiff: '@@working@@' })
    await usePRPreviewStore.getState().refresh('/repo')
    expect(usePRPreviewStore.getState().commitDiff).toBe('@@commit-abc@@')
  })

  it('toasts and clears the refreshing flag on errors', async () => {
    useToastStore.setState({ toasts: [] })
    usePRPreviewStore.setState({ baseBranch: 'main' })
    compareFiles.mockRejectedValue(new Error('offline'))
    compareDiff.mockResolvedValue('')
    compareCommits.mockResolvedValue([])
    workingFilesPR.mockResolvedValue([])
    workingDiff.mockResolvedValue('')
    await usePRPreviewStore.getState().refresh('/repo')
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: 'error', message: 'offline' })
    expect(usePRPreviewStore.getState().refreshing).toBe(false)
  })
})
