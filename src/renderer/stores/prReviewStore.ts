import { create } from 'zustand'
import type { PRFile, PRComment, PRReviewEvent, PRMergeMethod } from '../../shared/types'
import { useToastStore } from './toastStore'

interface PRReviewState {
  prNumber: number | null
  files: PRFile[]
  selectedFilePath: string | null
  fullDiff: string | null
  comments: PRComment[]
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
  loading: boolean
  reviewLoading: boolean
  mergeLoading: boolean

  loadPR: (repoPath: string, prNumber: number) => Promise<void>
  selectFile: (filePath: string) => void
  addComment: (repoPath: string, prNumber: number, body: string, path: string, startLine: number, endLine: number, side: 'LEFT' | 'RIGHT') => Promise<void>
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
  mergeable: 'UNKNOWN',
  loading: false,
  reviewLoading: false,
  mergeLoading: false,

  loadPR: async (repoPath, prNumber) => {
    set({ loading: true, prNumber, files: [], fullDiff: null, comments: [], mergeable: 'UNKNOWN', selectedFilePath: null })
    try {
      const [files, fullDiff, comments, mergeabilityResult] = await Promise.all([
        window.api.github.getFiles(repoPath, prNumber),
        window.api.github.getDiff(repoPath, prNumber),
        window.api.github.getComments(repoPath, prNumber),
        window.api.github.getMergeability(repoPath, prNumber),
      ])
      set({
        files,
        fullDiff,
        comments,
        mergeable: mergeabilityResult.mergeable,
        loading: false,
        selectedFilePath: files.length > 0 ? files[0].path : null,
      })
    } catch (err) {
      const { addToast } = useToastStore.getState()
      addToast('error', err instanceof Error ? err.message : String(err))
      set({ loading: false })
    }
  },

  selectFile: (filePath) => {
    set({ selectedFilePath: filePath })
  },

  addComment: async (repoPath, prNumber, body, path, startLine, endLine, side) => {
    const { addToast } = useToastStore.getState()
    try {
      const comment = await window.api.github.createComment(repoPath, prNumber, body, path, endLine, startLine !== endLine ? startLine : undefined, side)
      set({ comments: [...get().comments, comment] })
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : String(err))
    }
  },

  submitReview: async (repoPath, prNumber, event, body) => {
    const { addToast } = useToastStore.getState()
    set({ reviewLoading: true })
    try {
      await window.api.github.submitReview(repoPath, prNumber, event, body)
      const label = event === 'APPROVE' ? 'Approved' : event === 'REQUEST_CHANGES' ? 'Changes requested' : 'Comment submitted'
      addToast('success', `${label} on PR #${prNumber}`)
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : String(err))
    } finally {
      set({ reviewLoading: false })
    }
  },

  merge: async (repoPath, prNumber, method) => {
    const { addToast } = useToastStore.getState()
    set({ mergeLoading: true })
    try {
      await window.api.github.merge(repoPath, prNumber, method)
      addToast('success', `PR #${prNumber} merged`)
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : String(err))
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
      mergeable: 'UNKNOWN',
      loading: false,
      reviewLoading: false,
      mergeLoading: false,
    })
  },
}))
