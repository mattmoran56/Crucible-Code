import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGitStore, WORKING_CHANGES_HASH } from '../../../src/renderer/stores/gitStore'

const log = vi.fn()
const diff = vi.fn()
const fileDiff = vi.fn()
const workingFileDiff = vi.fn()
const workingFiles = vi.fn()
const commitStatuses = vi.fn()

beforeEach(() => {
  for (const fn of [log, diff, fileDiff, workingFileDiff, workingFiles, commitStatuses]) fn.mockReset()
  ;(window as any).api = {
    git: { log, diff, fileDiff, workingFileDiff, workingFiles, commitStatuses },
  }
  useGitStore.getState().clear()
})

describe('gitStore.loadCommits', () => {
  it('toggles loading and stores results', async () => {
    log.mockResolvedValue([{ hash: 'a1', message: 'm', author: 'me', date: 'today' }])
    const promise = useGitStore.getState().loadCommits('/repo')
    expect(useGitStore.getState().loading).toBe(true)
    await promise
    expect(useGitStore.getState().loading).toBe(false)
    expect(useGitStore.getState().commits).toHaveLength(1)
  })

  it('clears loading even if the api throws', async () => {
    log.mockRejectedValue(new Error('boom'))
    await expect(useGitStore.getState().loadCommits('/repo')).rejects.toThrow('boom')
    expect(useGitStore.getState().loading).toBe(false)
  })
})

describe('gitStore.loadWorkingFiles', () => {
  it('updates workingFiles, leaves changedFiles alone unless WORKING_CHANGES is selected', async () => {
    workingFiles.mockResolvedValue([{ filePath: 'a.ts', status: 'modified', insertions: 1, deletions: 0 }])
    await useGitStore.getState().loadWorkingFiles('/repo')
    expect(useGitStore.getState().workingFiles).toHaveLength(1)
    expect(useGitStore.getState().changedFiles).toHaveLength(0)
  })

  it('keeps changedFiles in sync when WORKING_CHANGES_HASH is the active selection', async () => {
    useGitStore.setState({ selectedCommitHash: WORKING_CHANGES_HASH } as any)
    workingFiles.mockResolvedValue([
      { filePath: 'a.ts', status: 'modified', insertions: 1, deletions: 0 },
    ])
    await useGitStore.getState().loadWorkingFiles('/repo')
    expect(useGitStore.getState().changedFiles).toHaveLength(1)
  })
})

describe('gitStore.selectCommit', () => {
  it('mirrors workingFiles into changedFiles when selecting WORKING_CHANGES', async () => {
    useGitStore.setState({
      workingFiles: [{ filePath: 'a.ts', status: 'modified', insertions: 1, deletions: 0 }],
    } as any)
    await useGitStore.getState().selectCommit('/repo', WORKING_CHANGES_HASH)
    expect(useGitStore.getState().selectedCommitHash).toBe(WORKING_CHANGES_HASH)
    expect(useGitStore.getState().changedFiles).toHaveLength(1)
    expect(diff).not.toHaveBeenCalled()
  })

  it('fetches diff for a real hash and resets file selection', async () => {
    useGitStore.setState({ selectedFilePath: 'b.ts', filePatch: 'old' } as any)
    diff.mockResolvedValue([{ filePath: 'a.ts', status: 'added', insertions: 1, deletions: 0 }])
    await useGitStore.getState().selectCommit('/repo', 'h1')
    expect(diff).toHaveBeenCalledWith('/repo', 'h1')
    expect(useGitStore.getState().selectedCommitHash).toBe('h1')
    expect(useGitStore.getState().changedFiles).toHaveLength(1)
    expect(useGitStore.getState().selectedFilePath).toBeNull()
    expect(useGitStore.getState().filePatch).toBeNull()
  })
})

describe('gitStore.selectFile', () => {
  it('uses workingFileDiff for working changes', async () => {
    workingFileDiff.mockResolvedValue('@@diff@@')
    await useGitStore.getState().selectFile('/repo', WORKING_CHANGES_HASH, 'a.ts')
    expect(workingFileDiff).toHaveBeenCalledWith('/repo', 'a.ts')
    expect(useGitStore.getState().selectedFilePath).toBe('a.ts')
    expect(useGitStore.getState().filePatch).toBe('@@diff@@')
  })

  it('uses fileDiff for a real commit', async () => {
    fileDiff.mockResolvedValue('@@diff@@')
    await useGitStore.getState().selectFile('/repo', 'h1', 'a.ts')
    expect(fileDiff).toHaveBeenCalledWith('/repo', 'h1', 'a.ts')
  })
})

describe('gitStore.loadCommitStatuses', () => {
  it('stores the statuses returned by the api', async () => {
    commitStatuses.mockResolvedValue({ unpushedHashes: ['a1', 'b2'], newBranchHashes: ['c3'] })
    await useGitStore.getState().loadCommitStatuses('/repo')
    expect(commitStatuses).toHaveBeenCalledWith('/repo')
    expect(useGitStore.getState().commitStatuses).toEqual({
      unpushedHashes: ['a1', 'b2'],
      newBranchHashes: ['c3'],
    })
  })

  it('replaces a previously loaded status snapshot wholesale', async () => {
    useGitStore.setState({
      commitStatuses: { unpushedHashes: ['old'], newBranchHashes: ['old-b'] },
    } as any)
    commitStatuses.mockResolvedValue({ unpushedHashes: [], newBranchHashes: ['n1'] })
    await useGitStore.getState().loadCommitStatuses('/repo')
    expect(useGitStore.getState().commitStatuses).toEqual({
      unpushedHashes: [],
      newBranchHashes: ['n1'],
    })
  })

  it('propagates api failures and keeps the previous statuses', async () => {
    useGitStore.setState({
      commitStatuses: { unpushedHashes: ['keep'], newBranchHashes: [] },
    } as any)
    commitStatuses.mockRejectedValue(new Error('not a repo'))
    await expect(useGitStore.getState().loadCommitStatuses('/repo')).rejects.toThrow('not a repo')
    expect(useGitStore.getState().commitStatuses).toEqual({
      unpushedHashes: ['keep'],
      newBranchHashes: [],
    })
  })
})

describe('gitStore.selectFile error propagation', () => {
  it('rejects from workingFileDiff, leaving the selection set and the patch null', async () => {
    workingFileDiff.mockRejectedValue(new Error('binary file'))
    await expect(
      useGitStore.getState().selectFile('/repo', WORKING_CHANGES_HASH, 'img.png')
    ).rejects.toThrow('binary file')
    expect(useGitStore.getState().selectedFilePath).toBe('img.png')
    expect(useGitStore.getState().filePatch).toBeNull()
  })

  it('rejects from fileDiff for a commit hash, leaving the selection set', async () => {
    fileDiff.mockRejectedValue(new Error('unknown object'))
    await expect(
      useGitStore.getState().selectFile('/repo', 'deadbeef', 'a.ts')
    ).rejects.toThrow('unknown object')
    expect(useGitStore.getState().selectedFilePath).toBe('a.ts')
    expect(useGitStore.getState().filePatch).toBeNull()
  })

  it('clears the previous patch synchronously while the next file diff is in flight', async () => {
    useGitStore.setState({ selectedFilePath: 'old.ts', filePatch: '@@old@@' } as any)
    let resolve: (v: string) => void = () => {}
    fileDiff.mockImplementationOnce(() => new Promise<string>((r) => { resolve = r }))
    const promise = useGitStore.getState().selectFile('/repo', 'h1', 'new.ts')
    expect(useGitStore.getState().selectedFilePath).toBe('new.ts')
    expect(useGitStore.getState().filePatch).toBeNull()
    resolve('@@new@@')
    await promise
    expect(useGitStore.getState().filePatch).toBe('@@new@@')
  })
})

describe('gitStore concurrent loads', () => {
  it('drops the loading flag as soon as the first of two concurrent loadCommits settles', async () => {
    let resolveA: (v: any) => void = () => {}
    let resolveB: (v: any) => void = () => {}
    log
      .mockImplementationOnce(() => new Promise((r) => { resolveA = r }))
      .mockImplementationOnce(() => new Promise((r) => { resolveB = r }))
    const pa = useGitStore.getState().loadCommits('/repo')
    const pb = useGitStore.getState().loadCommits('/repo')
    expect(useGitStore.getState().loading).toBe(true)
    resolveA([{ hash: 'a', message: 'm', author: 'me', date: 'd' }])
    await pa
    // Current behavior: the finally of the first call clears the shared flag
    // even though the second load is still in flight.
    expect(useGitStore.getState().loading).toBe(false)
    resolveB([{ hash: 'b', message: 'm', author: 'me', date: 'd' }])
    await pb
    expect(useGitStore.getState().loading).toBe(false)
  })

  it('lets the last-resolved concurrent loadCommits win the commits slot', async () => {
    let resolveFirst: (v: any) => void = () => {}
    log
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r }))
      .mockResolvedValueOnce([{ hash: 'second', message: 'm', author: 'me', date: 'd' }])
    const first = useGitStore.getState().loadCommits('/repo')
    await useGitStore.getState().loadCommits('/repo')
    expect(useGitStore.getState().commits[0].hash).toBe('second')
    resolveFirst([{ hash: 'first', message: 'm', author: 'me', date: 'd' }])
    await first
    // Current behavior: no staleness guard — the slower call overwrites.
    expect(useGitStore.getState().commits[0].hash).toBe('first')
  })

  it('a stale selectCommit diff overwrites the newer selection results', async () => {
    let resolveSlow: (v: any) => void = () => {}
    diff
      .mockImplementationOnce(() => new Promise((r) => { resolveSlow = r }))
      .mockResolvedValueOnce([{ filePath: 'h2.ts', status: 'added', insertions: 1, deletions: 0 }])
    const slow = useGitStore.getState().selectCommit('/repo', 'h1')
    await useGitStore.getState().selectCommit('/repo', 'h2')
    expect(useGitStore.getState().selectedCommitHash).toBe('h2')
    expect(useGitStore.getState().changedFiles[0].filePath).toBe('h2.ts')
    resolveSlow([{ filePath: 'h1.ts', status: 'added', insertions: 1, deletions: 0 }])
    await slow
    // Current behavior: the hash stays h2 but the late diff payload lands anyway.
    expect(useGitStore.getState().selectedCommitHash).toBe('h2')
    expect(useGitStore.getState().changedFiles[0].filePath).toBe('h1.ts')
  })
})

describe('gitStore empty results', () => {
  it('loadCommits with an empty log clears previously loaded commits', async () => {
    useGitStore.setState({
      commits: [{ hash: 'a', message: 'm', author: 'me', date: 'd' }],
    } as any)
    log.mockResolvedValue([])
    await useGitStore.getState().loadCommits('/repo')
    expect(useGitStore.getState().commits).toEqual([])
  })

  it('loadWorkingFiles with no changes empties both lists when WORKING_CHANGES is selected', async () => {
    useGitStore.setState({
      selectedCommitHash: WORKING_CHANGES_HASH,
      workingFiles: [{ filePath: 'a.ts', status: 'modified', insertions: 1, deletions: 0 }],
      changedFiles: [{ filePath: 'a.ts', status: 'modified', insertions: 1, deletions: 0 }],
    } as any)
    workingFiles.mockResolvedValue([])
    await useGitStore.getState().loadWorkingFiles('/repo')
    expect(useGitStore.getState().workingFiles).toEqual([])
    expect(useGitStore.getState().changedFiles).toEqual([])
  })

  it('selectCommit handles an empty diff for a real hash', async () => {
    diff.mockResolvedValue([])
    await useGitStore.getState().selectCommit('/repo', 'empty-commit')
    expect(useGitStore.getState().selectedCommitHash).toBe('empty-commit')
    expect(useGitStore.getState().changedFiles).toEqual([])
  })

  it('selecting WORKING_CHANGES with no working files yields an empty changedFiles list', async () => {
    await useGitStore.getState().selectCommit('/repo', WORKING_CHANGES_HASH)
    expect(useGitStore.getState().changedFiles).toEqual([])
    expect(diff).not.toHaveBeenCalled()
  })

  it('loadCommitStatuses tolerates empty status arrays', async () => {
    commitStatuses.mockResolvedValue({ unpushedHashes: [], newBranchHashes: [] })
    await useGitStore.getState().loadCommitStatuses('/repo')
    expect(useGitStore.getState().commitStatuses).toEqual({
      unpushedHashes: [],
      newBranchHashes: [],
    })
  })

  it('selectFile stores an empty-string patch as-is', async () => {
    fileDiff.mockResolvedValue('')
    await useGitStore.getState().selectFile('/repo', 'h1', 'renamed-only.ts')
    expect(useGitStore.getState().filePatch).toBe('')
  })
})

describe('gitStore.clear', () => {
  it('resets all derived state', () => {
    useGitStore.setState({
      commits: [{ hash: 'a', message: 'm', author: 'a', date: 'd' }],
      selectedCommitHash: 'a',
      changedFiles: [{ filePath: 'a', status: 'modified', insertions: 0, deletions: 0 }],
      selectedFilePath: 'a',
      filePatch: 'x',
      workingFiles: [{ filePath: 'a', status: 'modified', insertions: 0, deletions: 0 }],
      commitStatuses: { unpushedHashes: ['a'], newBranchHashes: ['b'] },
    } as any)
    useGitStore.getState().clear()
    const s = useGitStore.getState()
    expect(s.commits).toEqual([])
    expect(s.selectedCommitHash).toBeNull()
    expect(s.changedFiles).toEqual([])
    expect(s.selectedFilePath).toBeNull()
    expect(s.filePatch).toBeNull()
    expect(s.workingFiles).toEqual([])
    expect(s.commitStatuses).toEqual({ unpushedHashes: [], newBranchHashes: [] })
  })
})
