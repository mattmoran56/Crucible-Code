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
