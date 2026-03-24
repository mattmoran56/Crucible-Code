import { create } from 'zustand'
import type { PRFile, PRComment, PRReviewEvent, PRMergeMethod, PRDetail, PRConversationComment, PRCheck } from '../../shared/types'
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

  // Conversation tab state
  detail: PRDetail | null
  conversationComments: PRConversationComment[]
  checks: PRCheck[]
  checksPolling: boolean
  activeTab: 'conversation' | 'files'

  loadPR: (repoPath: string, prNumber: number) => Promise<void>
  selectFile: (filePath: string) => void
  addComment: (repoPath: string, prNumber: number, body: string, path: string, startLine: number, endLine: number, side: 'LEFT' | 'RIGHT') => Promise<void>
  submitReview: (repoPath: string, prNumber: number, event: PRReviewEvent, body?: string) => Promise<void>
  merge: (repoPath: string, prNumber: number, method: PRMergeMethod) => Promise<void>
  setActiveTab: (tab: 'conversation' | 'files') => void
  pollChecks: (repoPath: string, prNumber: number) => void
  stopPollingChecks: () => void
  clear: () => void
}

let checksIntervalId: ReturnType<typeof setInterval> | null = null

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
  detail: null,
  conversationComments: [],
  checks: [],
  checksPolling: false,
  activeTab: 'conversation',

  loadPR: async (repoPath, prNumber) => {
    set({
      loading: true, prNumber, files: [], fullDiff: null, comments: [],
      mergeable: 'UNKNOWN', selectedFilePath: null,
      detail: null, conversationComments: [], checks: [], activeTab: 'conversation',
    })
    try {
      const [files, fullDiff, comments, mergeabilityResult, detail, conversationComments, checks] = await Promise.all([
        window.api.github.getFiles(repoPath, prNumber),
        window.api.github.getDiff(repoPath, prNumber),
        window.api.github.getComments(repoPath, prNumber),
        window.api.github.getMergeability(repoPath, prNumber),
        window.api.github.getDetail(repoPath, prNumber),
        window.api.github.getConversationComments(repoPath, prNumber),
        window.api.github.getChecks(repoPath, prNumber),
      ])
      set({
        files,
        fullDiff,
        comments,
        mergeable: mergeabilityResult.mergeable,
        loading: false,
        selectedFilePath: files.length > 0 ? files[0].path : null,
        detail,
        conversationComments,
        checks,
      })
      // Start polling if any checks are still running
      const hasRunning = checks.some((c) => c.status !== 'completed')
      if (hasRunning) {
        get().pollChecks(repoPath, prNumber)
      }
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

  setActiveTab: (tab) => {
    set({ activeTab: tab })
  },

  pollChecks: (repoPath, prNumber) => {
    get().stopPollingChecks()
    set({ checksPolling: true })
    checksIntervalId = setInterval(async () => {
      try {
        const checks = await window.api.github.getChecks(repoPath, prNumber)
        const currentPR = get().prNumber
        if (currentPR !== prNumber) {
          get().stopPollingChecks()
          return
        }
        set({ checks })
        const allDone = checks.every((c) => c.status === 'completed')
        if (allDone) {
          get().stopPollingChecks()
        }
      } catch {
        // Silently ignore poll errors
      }
    }, 10_000)
  },

  stopPollingChecks: () => {
    if (checksIntervalId != null) {
      clearInterval(checksIntervalId)
      checksIntervalId = null
    }
    set({ checksPolling: false })
  },

  clear: () => {
    get().stopPollingChecks()
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
      detail: null,
      conversationComments: [],
      checks: [],
      checksPolling: false,
      activeTab: 'conversation',
    })
  },
}))
