import { create } from 'zustand'
import type { PRFile, PRComment, PRReviewEvent, PRMergeMethod } from '../../shared/types'

interface PRReviewState {
  prNumber: number | null
  files: PRFile[]
  selectedFilePath: string | null
  fullDiff: string | null
  comments: PRComment[]
  loading: boolean
  reviewLoading: boolean
  mergeLoading: boolean

  loadPR: (repoPath: string, prNumber: number) => Promise<void>
  selectFile: (filePath: string) => void
  addComment: (repoPath: string, prNumber: number, body: string, path: string, line: number) => Promise<void>
  submitReview: (repoPath: string, prNumber: number, event: PRReviewEvent, body?: string) => Promise<void>
  merge: (repoPath: string, prNumber: number, method: PRMergeMethod) => Promise<void>
  clear: () => void
}

export const usePRReviewStore = create<PRReviewState>((set, get) => ({
  prNumber: null,
  files: [],
  selectedFilePath: null,
  fullDiff: null,
  comments: [],
  loading: false,
  reviewLoading: false,
  mergeLoading: false,

  loadPR: async (repoPath, prNumber) => {
    set({ loading: true, prNumber, files: [], fullDiff: null, comments: [], selectedFilePath: null })
    const [files, fullDiff, comments] = await Promise.all([
      window.api.github.getFiles(repoPath, prNumber),
      window.api.github.getDiff(repoPath, prNumber),
      window.api.github.getComments(repoPath, prNumber),
    ])
    set({
      files,
      fullDiff,
      comments,
      loading: false,
      selectedFilePath: files.length > 0 ? files[0].path : null,
    })
  },

  selectFile: (filePath) => {
    set({ selectedFilePath: filePath })
  },

  addComment: async (repoPath, prNumber, body, path, line) => {
    const comment = await window.api.github.createComment(repoPath, prNumber, body, path, line)
    set({ comments: [...get().comments, comment] })
  },

  submitReview: async (repoPath, prNumber, event, body) => {
    set({ reviewLoading: true })
    try {
      await window.api.github.submitReview(repoPath, prNumber, event, body)
    } finally {
      set({ reviewLoading: false })
    }
  },

  merge: async (repoPath, prNumber, method) => {
    set({ mergeLoading: true })
    try {
      await window.api.github.merge(repoPath, prNumber, method)
    } finally {
      set({ mergeLoading: false })
    }
  },

  clear: () => {
    set({
      prNumber: null,
      files: [],
      selectedFilePath: null,
      fullDiff: null,
      comments: [],
      loading: false,
      reviewLoading: false,
      mergeLoading: false,
    })
  },
}))
