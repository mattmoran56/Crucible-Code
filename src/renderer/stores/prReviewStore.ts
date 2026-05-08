import { create } from 'zustand'
import type { PRFile, PRComment, PRReviewEvent, PRMergeMethod, PRDetail, PRConversationComment, PRCheck, Commit, PRReviewThread, GitHubCollaborator } from '../../shared/types'
import { useToastStore } from './toastStore'

export type BlobSide = 'base' | 'head'

interface BlobCacheEntry {
  /** Full file content split into lines (without trailing empty element) */
  lines: string[]
  /** Loading promise so concurrent calls share work */
  promise?: Promise<string[] | null>
}

interface PRReviewState {
  prNumber: number | null
  files: PRFile[]
  selectedFilePath: string | null
  fullDiff: string | null
  fileDiffCache: Record<string, string>
  fileDiffLoading: string | null
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
  activeTab: 'conversation' | 'files' | 'commits'

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

  // Reviewers
  collaborators: GitHubCollaborator[]
  reviewerLoading: boolean

  // Expand-context: cache of fetched blobs and per-file expanded line numbers
  // key for blob cache: `${side}:${path}`; expandedLines key: `${side}:${path}` -> Set<number>
  blobCache: Record<string, BlobCacheEntry>
  expandedLines: Record<string, Set<number>>

  loadPR: (repoPath: string, prNumber: number, projectId?: string, force?: boolean) => Promise<void>
  selectFile: (filePath: string) => void
  selectNextFile: () => void
  selectPrevFile: () => void
  setViewMode: (mode: 'single' | 'scroll') => void
  toggleFileViewed: (projectId: string, prNumber: number, filePath: string) => void
  selectCommit: (repoPath: string, hash: string | null) => Promise<void>
  nextCommit: (repoPath: string) => Promise<void>
  prevCommit: (repoPath: string) => Promise<void>
  loadFileDiff: (repoPath: string, prNumber: number, filePath: string) => Promise<void>
  addComment: (repoPath: string, prNumber: number, body: string, path: string, startLine: number, endLine: number, side: 'LEFT' | 'RIGHT') => Promise<void>
  submitReview: (repoPath: string, prNumber: number, event: PRReviewEvent, body?: string) => Promise<void>
  merge: (repoPath: string, prNumber: number, method: PRMergeMethod) => Promise<void>
  setCommentFilter: (filter: 'all' | 'unresolved') => void
  setActiveTab: (tab: 'conversation' | 'files' | 'commits') => void
  pollChecks: (repoPath: string, prNumber: number) => void
  stopPollingChecks: () => void
  clear: () => void

  // Reviewers
  loadCollaborators: (repoPath: string) => Promise<void>
  addReviewer: (repoPath: string, prNumber: number, login: string) => Promise<void>
  removeReviewer: (repoPath: string, prNumber: number, login: string) => Promise<void>

  // Threads
  replyToThread: (repoPath: string, prNumber: number, rootCommentId: number, body: string) => Promise<void>
  resolveThread: (repoPath: string, prNumber: number, threadId: string) => Promise<void>
  unresolveThread: (repoPath: string, prNumber: number, threadId: string) => Promise<void>

  // Expand-context
  expandContext: (
    repoPath: string,
    filePath: string,
    side: BlobSide,
    fromLine: number,
    toLine: number
  ) => Promise<void>
  resetExpandedLines: (filePath: string, side: BlobSide) => void

  // Suggestion apply
  applySuggestion: (
    repoPath: string,
    filePath: string,
    startLine: number,
    endLine: number,
    newText: string,
    author: string
  ) => Promise<{ applied: boolean; reason?: string }>
}

let checksIntervalId: ReturnType<typeof setInterval> | null = null

export const usePRReviewStore = create<PRReviewState>((set, get) => ({
  prNumber: null,
  files: [],
  selectedFilePath: null,
  fullDiff: null,
  fileDiffCache: {},
  fileDiffLoading: null,
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
  collaborators: [],
  reviewerLoading: false,
  blobCache: {},
  expandedLines: {},

  loadPR: async (repoPath, prNumber, projectId, force = false) => {
    // Skip reload if this PR's data is already loaded (unless forced)
    if (!force && get().prNumber === prNumber && get().files.length > 0) return

    if (force) {
      // Refresh in place — keep current data visible while refetching so the
      // user doesn't see the panel flash empty.
      set({ loading: true, prNumber })
    } else {
      set({
        loading: true, prNumber, files: [], fullDiff: null, fileDiffCache: {}, fileDiffLoading: null,
        comments: [], mergeable: 'UNKNOWN', selectedFilePath: null,
        detail: null, conversationComments: [], checks: [], activeTab: 'conversation',
        blobCache: {}, expandedLines: {},
      })
    }
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
      // Preserve current selection if still present after refresh.
      const prevSelected = get().selectedFilePath
      const stillThere = prevSelected && files.some((f) => f.path === prevSelected)
      set({
        files,
        fullDiff,
        comments,
        mergeable: mergeabilityResult.mergeable,
        loading: false,
        selectedFilePath: stillThere ? prevSelected : (files.length > 0 ? files[0].path : null),
        detail,
        conversationComments,
        checks,
        viewedFiles: new Set(viewedFilesArr),
        commits,
        selectedCommitHash: force ? get().selectedCommitHash : null,
        commitDiff: force ? get().commitDiff : null,
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
      await get().selectCommit(repoPath, null)
    }
  },

  loadFileDiff: async (repoPath, prNumber, filePath) => {
    const { fileDiffCache } = get()
    if (fileDiffCache[filePath]) return
    set({ fileDiffLoading: filePath })
    try {
      const patch = await window.api.github.getFilePatch(repoPath, prNumber, filePath)
      set({
        fileDiffCache: { ...get().fileDiffCache, [filePath]: patch },
        fileDiffLoading: get().selectedFilePath === filePath ? null : get().fileDiffLoading,
      })
    } catch (err) {
      const { addToast } = useToastStore.getState()
      addToast('error', err instanceof Error ? err.message : String(err))
    } finally {
      if (get().fileDiffLoading === filePath) {
        set({ fileDiffLoading: null })
      }
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

  loadCollaborators: async (repoPath) => {
    if (get().collaborators.length > 0) return
    try {
      const collaborators = await window.api.github.listCollaborators(repoPath)
      set({ collaborators })
    } catch {
      // Non-critical
    }
  },

  addReviewer: async (repoPath, prNumber, login) => {
    const { addToast } = useToastStore.getState()
    set({ reviewerLoading: true })
    try {
      await window.api.github.addReviewer(repoPath, prNumber, login)
      const detail = await window.api.github.getDetail(repoPath, prNumber)
      set({ detail })
      addToast('success', `Requested review from ${login}`)
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : String(err))
    } finally {
      set({ reviewerLoading: false })
    }
  },

  removeReviewer: async (repoPath, prNumber, login) => {
    const { addToast } = useToastStore.getState()
    set({ reviewerLoading: true })
    try {
      await window.api.github.removeReviewer(repoPath, prNumber, login)
      const detail = await window.api.github.getDetail(repoPath, prNumber)
      set({ detail })
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : String(err))
    } finally {
      set({ reviewerLoading: false })
    }
  },

  replyToThread: async (repoPath, prNumber, rootCommentId, body) => {
    const { addToast } = useToastStore.getState()
    try {
      const reply = await window.api.github.replyThread(repoPath, prNumber, rootCommentId, body)
      // Append to comments list and to the matching thread
      set({
        comments: [...get().comments, reply],
        reviewThreads: get().reviewThreads.map((t) =>
          t.rootCommentId === rootCommentId
            ? { ...t, comments: [...t.comments, reply] }
            : t
        ),
      })
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : String(err))
    }
  },

  resolveThread: async (repoPath, prNumber, threadId) => {
    const { addToast } = useToastStore.getState()
    try {
      await window.api.github.resolveThread(repoPath, threadId)
      set({
        reviewThreads: get().reviewThreads.map((t) =>
          t.id === threadId ? { ...t, isResolved: true } : t
        ),
      })
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : String(err))
    }
  },

  unresolveThread: async (repoPath, prNumber, threadId) => {
    const { addToast } = useToastStore.getState()
    try {
      await window.api.github.unresolveThread(repoPath, threadId)
      set({
        reviewThreads: get().reviewThreads.map((t) =>
          t.id === threadId ? { ...t, isResolved: false } : t
        ),
      })
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : String(err))
    }
  },

  expandContext: async (repoPath, filePath, side, fromLine, toLine) => {
    const { detail } = get()
    if (!detail) return
    const ref = side === 'base' ? detail.baseRefOid : detail.headRefOid
    if (!ref) return

    const cacheKey = `${side}:${filePath}`
    let entry = get().blobCache[cacheKey]

    if (!entry || !entry.lines) {
      const fetchPromise: Promise<string[] | null> = (async () => {
        const raw = await window.api.github.getFileBlob(repoPath, ref, filePath)
        if (raw == null) return null
        const lines = raw.split('\n')
        if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
        return lines
      })()

      // Reserve the entry to dedupe concurrent calls
      set({
        blobCache: {
          ...get().blobCache,
          [cacheKey]: { lines: [], promise: fetchPromise },
        },
      })

      const lines = await fetchPromise
      if (!lines) {
        // Drop the placeholder so a future click can retry
        const next = { ...get().blobCache }
        delete next[cacheKey]
        set({ blobCache: next })
        return
      }
      entry = { lines }
      set({
        blobCache: { ...get().blobCache, [cacheKey]: entry },
      })
    } else if (entry.promise) {
      const lines = await entry.promise
      if (!lines) return
    }

    // Mark the requested range as expanded.
    const lo = Math.max(1, Math.min(fromLine, toLine))
    const hi = Math.max(fromLine, toLine)
    const expandedKey = `${side}:${filePath}`
    const existing = get().expandedLines[expandedKey] || new Set<number>()
    const next = new Set(existing)
    for (let n = lo; n <= hi; n++) next.add(n)
    set({
      expandedLines: { ...get().expandedLines, [expandedKey]: next },
    })
  },

  resetExpandedLines: (filePath, side) => {
    const key = `${side}:${filePath}`
    const next = { ...get().expandedLines }
    delete next[key]
    set({ expandedLines: next })
  },

  applySuggestion: async (repoPath, filePath, startLine, endLine, newText, author) => {
    const { addToast } = useToastStore.getState()
    try {
      const result = await window.api.github.applySuggestion(
        repoPath, filePath, startLine, endLine, newText, author
      )
      if (result.applied) {
        addToast('success', `Applied suggestion to ${filePath}`)
      } else {
        addToast('error', result.reason || 'Could not apply suggestion')
      }
      return result
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      addToast('error', reason)
      return { applied: false, reason }
    }
  },

  clear: () => {
    get().stopPollingChecks()
    set({
      prNumber: null,
      files: [],
      selectedFilePath: null,
      fullDiff: null,
      fileDiffCache: {},
      fileDiffLoading: null,
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
      blobCache: {},
      expandedLines: {},
    })
  },
}))
