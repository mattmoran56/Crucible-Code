import { create } from 'zustand'
import type { PRFile, PRComment, PRReviewEvent, PRMergeMethod, PRDetail, PRConversationComment, PRCheck, Commit, PRReviewThread } from '../../shared/types'
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

  // Viewed files
  viewedFiles: Set<string>

  // Commit review
  commits: Commit[]
  selectedCommitHash: string | null
  commitDiff: string | null

  // View mode
  viewMode: 'single' | 'scroll'

  // Review threads
  reviewThreads: PRReviewThread[]
  commentFilter: 'all' | 'unresolved'

  loadPR: (repoPath: string, prNumber: number, projectId?: string) => Promise<void>
  selectFile: (filePath: string) => void
  selectNextFile: () => void
  selectPrevFile: () => void
  setViewMode: (mode: 'single' | 'scroll') => void
  toggleFileViewed: (projectId: string, prNumber: number, filePath: string) => void
  selectCommit: (repoPath: string, hash: string | null) => Promise<void>
  nextCommit: (repoPath: string) => Promise<void>
  prevCommit: (repoPath: string) => Promise<void>
  addComment: (repoPath: string, prNumber: number, body: string, path: string, startLine: number, endLine: number, side: 'LEFT' | 'RIGHT') => Promise<void>
  submitReview: (repoPath: string, prNumber: number, event: PRReviewEvent, body?: string) => Promise<void>
  merge: (repoPath: string, prNumber: number, method: PRMergeMethod) => Promise<void>
  setCommentFilter: (filter: 'all' | 'unresolved') => void
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
  viewedFiles: new Set<string>(),
  commits: [],
  selectedCommitHash: null,
  commitDiff: null,
  viewMode: 'single',
  reviewThreads: [],
  commentFilter: 'all',

  loadPR: async (repoPath, prNumber, projectId) => {
    set({
      loading: true, prNumber, files: [], fullDiff: null, comments: [],
      mergeable: 'UNKNOWN', selectedFilePath: null,
      detail: null, conversationComments: [], checks: [], activeTab: 'conversation',
    })
    try {
      const [files, fullDiff, comments, mergeabilityResult, detail, conversationComments, checks, viewedFilesArr, commits, reviewThreads] = await Promise.all([
        window.api.github.getFiles(repoPath, prNumber),
        window.api.github.getDiff(repoPath, prNumber),
        window.api.github.getComments(repoPath, prNumber),
        window.api.github.getMergeability(repoPath, prNumber),
        window.api.github.getDetail(repoPath, prNumber),
        window.api.github.getConversationComments(repoPath, prNumber),
        window.api.github.getChecks(repoPath, prNumber),
        projectId ? window.api.github.getViewedFiles(projectId, prNumber) : Promise.resolve([]),
        window.api.github.getCommits(repoPath, prNumber),
        window.api.github.getReviewThreads(repoPath, prNumber),
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
        viewedFiles: new Set(viewedFilesArr),
        commits,
        selectedCommitHash: null,
        commitDiff: null,
        reviewThreads,
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

  setViewMode: (mode) => {
    set({ viewMode: mode })
  },

  toggleFileViewed: (projectId, prNumber, filePath) => {
    const viewed = new Set(get().viewedFiles)
    if (viewed.has(filePath)) {
      viewed.delete(filePath)
    } else {
      viewed.add(filePath)
    }
    set({ viewedFiles: viewed })
    window.api.github.setViewedFiles(projectId, prNumber, [...viewed])
  },

  selectCommit: async (repoPath, hash) => {
    if (hash === null) {
      set({ selectedCommitHash: null, commitDiff: null, selectedFilePath: null })
      // Re-select first file from full PR files
      const { files } = get()
      if (files.length > 0) set({ selectedFilePath: files[0].path })
      return
    }
    set({ selectedCommitHash: hash, selectedFilePath: null })
    try {
      const commitDiff = await window.api.github.getCommitDiff(repoPath, hash)
      set({ commitDiff })
    } catch (err) {
      const { addToast } = useToastStore.getState()
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
      // Go back to "all changes"
      await get().selectCommit(repoPath, null)
    }
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

  setCommentFilter: (filter) => {
    set({ commentFilter: filter })
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
      viewedFiles: new Set<string>(),
      commits: [],
      selectedCommitHash: null,
      commitDiff: null,
      reviewThreads: [],
      commentFilter: 'all',
    })
  },
}))
