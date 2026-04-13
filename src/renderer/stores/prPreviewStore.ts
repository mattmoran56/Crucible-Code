import { create } from 'zustand'
import type { PRFile, Commit } from '../../shared/types'
import { useToastStore } from './toastStore'

interface PRPreviewState {
  active: boolean
  baseBranch: string | null
  files: PRFile[]
  fullDiff: string | null
  commits: Commit[]
  selectedFilePath: string | null
  selectedCommitHash: string | null
  commitDiff: string | null
  viewMode: 'single' | 'scroll'
  loading: boolean

  activate: (repoPath: string, branch: string) => Promise<void>
  deactivate: () => void
  setBaseBranch: (repoPath: string, branch: string) => Promise<void>
  selectFile: (filePath: string) => void
  selectNextFile: () => void
  selectPrevFile: () => void
  selectCommit: (repoPath: string, hash: string | null) => Promise<void>
  nextCommit: (repoPath: string) => Promise<void>
  prevCommit: (repoPath: string) => Promise<void>
  setViewMode: (mode: 'single' | 'scroll') => void
  refresh: (repoPath: string) => Promise<void>
}

export const usePRPreviewStore = create<PRPreviewState>((set, get) => ({
  active: false,
  baseBranch: null,
  files: [],
  fullDiff: null,
  commits: [],
  selectedFilePath: null,
  selectedCommitHash: null,
  commitDiff: null,
  viewMode: 'single',
  loading: false,

  activate: async (repoPath, branch) => {
    set({ active: true, loading: true })
    await get().setBaseBranch(repoPath, branch)
  },

  deactivate: () => {
    set({
      active: false,
      baseBranch: null,
      files: [],
      fullDiff: null,
      commits: [],
      selectedFilePath: null,
      selectedCommitHash: null,
      commitDiff: null,
      loading: false,
    })
  },

  setBaseBranch: async (repoPath, branch) => {
    set({
      baseBranch: branch,
      loading: true,
      files: [],
      fullDiff: null,
      commits: [],
      selectedFilePath: null,
      selectedCommitHash: null,
      commitDiff: null,
    })
    const { addToast } = useToastStore.getState()
    try {
      const [files, fullDiff, commits] = await Promise.all([
        window.api.git.compareFiles(repoPath, branch),
        window.api.git.compareDiff(repoPath, branch),
        window.api.git.compareCommits(repoPath, branch),
      ])
      set({
        files,
        fullDiff,
        commits,
        selectedFilePath: files.length > 0 ? files[0].path : null,
        loading: false,
      })
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : String(err))
      set({ loading: false })
    }
  },

  selectFile: (filePath) => {
    set({ selectedFilePath: filePath })
  },

  selectNextFile: () => {
    const { files, selectedFilePath } = get()
    if (files.length === 0) return
    const idx = selectedFilePath ? files.findIndex((f) => f.path === selectedFilePath) : -1
    const nextIdx = Math.min(idx + 1, files.length - 1)
    set({ selectedFilePath: files[nextIdx].path })
  },

  selectPrevFile: () => {
    const { files, selectedFilePath } = get()
    if (files.length === 0 || !selectedFilePath) return
    const idx = files.findIndex((f) => f.path === selectedFilePath)
    const prevIdx = Math.max(idx - 1, 0)
    set({ selectedFilePath: files[prevIdx].path })
  },

  selectCommit: async (repoPath, hash) => {
    if (hash === null) {
      set({ selectedCommitHash: null, commitDiff: null, selectedFilePath: null })
      const { files } = get()
      if (files.length > 0) set({ selectedFilePath: files[0].path })
      return
    }
    set({ selectedCommitHash: hash, selectedFilePath: null })
    const { addToast } = useToastStore.getState()
    try {
      const commitDiff = await window.api.git.commitFullDiff(repoPath, hash)
      set({ commitDiff })
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : String(err))
      set({ commitDiff: null })
    }
  },

  nextCommit: async (repoPath) => {
    const { commits, selectedCommitHash } = get()
    if (commits.length === 0) return
    const idx = selectedCommitHash ? commits.findIndex((c) => c.hash === selectedCommitHash) : -1
    const nextIdx = idx + 1
    if (nextIdx < commits.length) {
      await get().selectCommit(repoPath, commits[nextIdx].hash)
    }
  },

  prevCommit: async (repoPath) => {
    const { commits, selectedCommitHash } = get()
    if (commits.length === 0 || !selectedCommitHash) return
    const idx = commits.findIndex((c) => c.hash === selectedCommitHash)
    if (idx > 0) {
      await get().selectCommit(repoPath, commits[idx - 1].hash)
    } else if (idx === 0) {
      await get().selectCommit(repoPath, null)
    }
  },

  setViewMode: (mode) => {
    set({ viewMode: mode })
  },

  refresh: async (repoPath) => {
    const { baseBranch } = get()
    if (!baseBranch) return
    await get().setBaseBranch(repoPath, baseBranch)
  },
}))
