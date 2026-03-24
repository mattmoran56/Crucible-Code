import { create } from 'zustand'
import type { Commit, FileDiff } from '../../shared/types'

export const WORKING_CHANGES_HASH = 'WORKING_CHANGES'

interface CommitStatuses {
  unpushedHashes: string[]
  newBranchHashes: string[]
}

interface GitState {
  commits: Commit[]
  selectedCommitHash: string | null
  changedFiles: FileDiff[]
  selectedFilePath: string | null
  filePatch: string | null
  loading: boolean
  workingFiles: FileDiff[]
  commitStatuses: CommitStatuses
  loadCommits: (repoPath: string) => Promise<void>
  loadWorkingFiles: (repoPath: string) => Promise<void>
  loadCommitStatuses: (repoPath: string) => Promise<void>
  selectCommit: (repoPath: string, hash: string) => Promise<void>
  selectFile: (repoPath: string, commitHash: string, filePath: string) => Promise<void>
  clear: () => void
}

export const useGitStore = create<GitState>((set, get) => ({
  commits: [],
  selectedCommitHash: null,
  changedFiles: [],
  selectedFilePath: null,
  filePatch: null,
  loading: false,
  workingFiles: [],
  commitStatuses: { unpushedHashes: [], newBranchHashes: [] },

  loadCommits: async (repoPath: string) => {
    set({ loading: true })
    try {
      const commits = await window.api.git.log(repoPath)
      set({ commits })
    } finally {
      set({ loading: false })
    }
  },

  loadWorkingFiles: async (repoPath: string) => {
    const workingFiles = await window.api.git.workingFiles(repoPath)
    set((state) => {
      // If WORKING_CHANGES is selected, keep changedFiles in sync
      if (state.selectedCommitHash === WORKING_CHANGES_HASH) {
        return { workingFiles, changedFiles: workingFiles }
      }
      return { workingFiles }
    })
  },

  loadCommitStatuses: async (repoPath: string) => {
    const commitStatuses = await window.api.git.commitStatuses(repoPath)
    set({ commitStatuses })
  },

  selectCommit: async (repoPath: string, hash: string) => {
    if (hash === WORKING_CHANGES_HASH) {
      const { workingFiles } = get()
      set({
        selectedCommitHash: WORKING_CHANGES_HASH,
        changedFiles: workingFiles,
        selectedFilePath: null,
        filePatch: null,
      })
      return
    }
    set({ selectedCommitHash: hash, changedFiles: [], selectedFilePath: null, filePatch: null })
    const changedFiles = await window.api.git.diff(repoPath, hash)
    set({ changedFiles })
  },

  selectFile: async (repoPath: string, commitHash: string, filePath: string) => {
    set({ selectedFilePath: filePath, filePatch: null })
    let patch: string
    if (commitHash === WORKING_CHANGES_HASH) {
      patch = await window.api.git.workingFileDiff(repoPath, filePath)
    } else {
      patch = await window.api.git.fileDiff(repoPath, commitHash, filePath)
    }
    set({ filePatch: patch })
  },

  clear: () => {
    set({
      commits: [],
      selectedCommitHash: null,
      changedFiles: [],
      selectedFilePath: null,
      filePatch: null,
      workingFiles: [],
      commitStatuses: { unpushedHashes: [], newBranchHashes: [] },
    })
  },
}))
