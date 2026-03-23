import { create } from 'zustand'
import type { Commit, FileDiff } from '../../shared/types'

interface GitState {
  commits: Commit[]
  selectedCommitHash: string | null
  changedFiles: FileDiff[]
  selectedFilePath: string | null
  filePatch: string | null
  loading: boolean
  loadCommits: (repoPath: string) => Promise<void>
  selectCommit: (repoPath: string, hash: string) => Promise<void>
  selectFile: (repoPath: string, commitHash: string, filePath: string) => Promise<void>
  clear: () => void
}

export const useGitStore = create<GitState>((set) => ({
  commits: [],
  selectedCommitHash: null,
  changedFiles: [],
  selectedFilePath: null,
  filePatch: null,
  loading: false,

  loadCommits: async (repoPath: string) => {
    set({ loading: true })
    try {
      const commits = await window.api.git.log(repoPath)
      set({ commits, selectedCommitHash: null, changedFiles: [], selectedFilePath: null, filePatch: null })
    } finally {
      set({ loading: false })
    }
  },

  selectCommit: async (repoPath: string, hash: string) => {
    set({ selectedCommitHash: hash, changedFiles: [], selectedFilePath: null, filePatch: null })
    const changedFiles = await window.api.git.diff(repoPath, hash)
    set({ changedFiles })
  },

  selectFile: async (repoPath: string, commitHash: string, filePath: string) => {
    set({ selectedFilePath: filePath, filePatch: null })
    const patch = await window.api.git.fileDiff(repoPath, commitHash, filePath)
    set({ filePatch: patch })
  },

  clear: () => {
    set({
      commits: [],
      selectedCommitHash: null,
      changedFiles: [],
      selectedFilePath: null,
      filePatch: null,
    })
  },
}))
