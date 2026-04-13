import { create } from 'zustand'
import type { PRFile, Commit } from '../../shared/types'
import { useToastStore } from './toastStore'

export const WORKING_CHANGES_HASH = 'WORKING_CHANGES'

interface PRPreviewState {
  active: boolean
  baseBranch: string | null
  /** All files: committed changes + uncommitted working changes (deduped) */
  files: PRFile[]
  /** Full diff: committed diff + working diff appended */
  fullDiff: string | null
  /** Working diff only (staged + unstaged) */
  workingDiff: string | null
  /** Working files as PRFile[] */
  workingFiles: PRFile[]
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

/** Merge committed files with working files, deduping by path (working wins) */
function mergeFiles(committedFiles: PRFile[], workingFiles: PRFile[]): PRFile[] {
  const seen = new Set<string>()
  const result: PRFile[] = []
  // Working files first so they take precedence in the set
  for (const f of workingFiles) {
    seen.add(f.path)
    result.push(f)
  }
  for (const f of committedFiles) {
    if (!seen.has(f.path)) {
      result.push(f)
    }
  }
  // Sort alphabetically by path
  result.sort((a, b) => a.path.localeCompare(b.path))
  return result
}

export const usePRPreviewStore = create<PRPreviewState>((set, get) => ({
  active: false,
  baseBranch: null,
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
      workingDiff: null,
      workingFiles: [],
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
      workingDiff: null,
      workingFiles: [],
      commits: [],
      selectedFilePath: null,
      selectedCommitHash: null,
      commitDiff: null,
    })
    const { addToast } = useToastStore.getState()
    try {
      const [committedFiles, compareDiff, commits, wFiles, wDiff] = await Promise.all([
        window.api.git.compareFiles(repoPath, branch),
        window.api.git.compareDiff(repoPath, branch),
        window.api.git.compareCommits(repoPath, branch),
        window.api.git.workingFilesPR(repoPath),
        window.api.git.workingDiff(repoPath),
      ])
      // Merge committed + working into full view
      const allFiles = mergeFiles(committedFiles, wFiles)
      const fullDiff = wDiff
        ? [compareDiff, wDiff].filter(Boolean).join('\n')
        : compareDiff
      set({
        files: allFiles,
        fullDiff,
        workingDiff: wDiff || null,
        workingFiles: wFiles,
        commits,
        selectedFilePath: allFiles.length > 0 ? allFiles[0].path : null,
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
    // Working changes pseudo-commit — use already-loaded working diff
    if (hash === WORKING_CHANGES_HASH) {
      const { workingDiff } = get()
      set({ selectedCommitHash: WORKING_CHANGES_HASH, commitDiff: workingDiff, selectedFilePath: null })
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
    const { commits, selectedCommitHash, workingFiles } = get()
    // Build full list: commits + working changes pseudo-entry
    const allHashes = commits.map((c) => c.hash)
    if (workingFiles.length > 0) allHashes.push(WORKING_CHANGES_HASH)

    if (allHashes.length === 0) return
    const idx = selectedCommitHash ? allHashes.indexOf(selectedCommitHash) : -1
    const nextIdx = idx + 1
    if (nextIdx < allHashes.length) {
      await get().selectCommit(repoPath, allHashes[nextIdx])
    }
  },

  prevCommit: async (repoPath) => {
    const { commits, selectedCommitHash, workingFiles } = get()
    const allHashes = commits.map((c) => c.hash)
    if (workingFiles.length > 0) allHashes.push(WORKING_CHANGES_HASH)

    if (allHashes.length === 0 || !selectedCommitHash) return
    const idx = allHashes.indexOf(selectedCommitHash)
    if (idx > 0) {
      await get().selectCommit(repoPath, allHashes[idx - 1])
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
