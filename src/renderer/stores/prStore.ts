import { create } from 'zustand'
import type { PullRequest, GitHubCollaborator, LocalPR } from '../../shared/types'

/**
 * Adapt a local PR into a PullRequest so it can render in the normal PR list as
 * a middle stage between draft and open. Synthetic `number` is `-localNumber`
 * so it never collides with a real PR number; once promoted the real PR (same
 * `realPrNumber`) supersedes it (see the dedupe in `recompute`).
 */
function localToPullRequest(lpr: LocalPR): PullRequest {
  return {
    number: lpr.realPrNumber ?? -lpr.localNumber,
    title: lpr.title,
    headRefName: lpr.branch,
    baseRefName: lpr.baseBranch,
    author: '',
    assignees: [],
    requestedReviewers: [],
    createdAt: lpr.createdAt,
    updatedAt: lpr.updatedAt,
    isDraft: lpr.status === 'local' || lpr.status === 'promoting',
    state: lpr.status === 'merged' ? 'MERGED' : 'OPEN',
    ciStatus: lpr.ciResult?.status ?? 'none',
    labels: [],
    commentsCount: 0,
    reviews: [],
    isLocal: true,
    localPrId: lpr.id,
  }
}

interface PRState {
  // Per-repo / per-project caches so toggling between projects shows the
  // last-known state instantly instead of flashing empty until the gh fetch
  // returns. Keys: prCache[repoPath], seenCache[projectId].
  prCache: Record<string, PullRequest[]>
  localPRCache: Record<string, LocalPR[]>
  seenCache: Record<string, number[]>
  collaboratorsCache: Record<string, GitHubCollaborator[]>
  // Tracks which repo/project the visible state belongs to, so a slow
  // background fetch can't overwrite the displayed PRs after the user has
  // already switched to a different project.
  currentRepoPath: string | null
  currentProjectId: string | null
  // Remote PRs from gh and local PRs are kept separately; `pullRequests` is the
  // merged, deduped view that the UI consumes.
  remotePRs: PullRequest[]
  localPRs: LocalPR[]
  pullRequests: PullRequest[]
  seenPRs: number[]
  loading: boolean
  hasLoaded: boolean
  currentUser: string | null
  loadPRs: (repoPath: string) => Promise<void>
  loadLocalPRs: (projectId: string) => Promise<void>
  applyLocalPRUpdate: (projectId: string, list: LocalPR[]) => void
  loadSeenPRs: (projectId: string) => Promise<void>
  loadCurrentUser: (repoPath: string) => Promise<void>
  loadCollaborators: (repoPath: string) => Promise<GitHubCollaborator[]>
  markSeen: (projectId: string, prNumber: number) => void
  clear: () => void
}

/** Merge local + remote, dropping local entries already promoted to a real PR. */
function merge(remotePRs: PullRequest[], localPRs: LocalPR[]): PullRequest[] {
  const remoteNumbers = new Set(remotePRs.map((p) => p.number))
  const localView = localPRs
    .filter((lpr) => !(lpr.realPrNumber && remoteNumbers.has(lpr.realPrNumber)))
    .map(localToPullRequest)
  // Local PRs first — they're the actionable "promote me" stage.
  return [...localView, ...remotePRs]
}

export const usePRStore = create<PRState>((set, get) => ({
  prCache: {},
  localPRCache: {},
  seenCache: {},
  collaboratorsCache: {},
  currentRepoPath: null,
  currentProjectId: null,
  remotePRs: [],
  localPRs: [],
  pullRequests: [],
  seenPRs: [],
  loading: false,
  hasLoaded: false,
  currentUser: null,

  loadPRs: async (repoPath: string) => {
    const state = get()
    if (state.currentRepoPath !== repoPath) {
      const cached = state.prCache[repoPath]
      set({
        currentRepoPath: repoPath,
        remotePRs: cached ?? [],
        pullRequests: merge(cached ?? [], get().localPRs),
        loading: !cached,
        hasLoaded: !!cached,
      })
    }

    const fresh = await window.api.github.listPRs(repoPath)
    set((s) => ({ prCache: { ...s.prCache, [repoPath]: fresh } }))

    if (get().currentRepoPath === repoPath) {
      set({
        remotePRs: fresh,
        pullRequests: merge(fresh, get().localPRs),
        loading: false,
        hasLoaded: true,
      })
    }
  },

  loadLocalPRs: async (projectId: string) => {
    const cached = get().localPRCache[projectId]
    if (cached) {
      set({ localPRs: cached, pullRequests: merge(get().remotePRs, cached) })
    }
    const fresh = await window.api.localPr.list(projectId)
    set((s) => ({ localPRCache: { ...s.localPRCache, [projectId]: fresh } }))
    set({ localPRs: fresh, pullRequests: merge(get().remotePRs, fresh) })
  },

  applyLocalPRUpdate: (projectId: string, list: LocalPR[]) => {
    set((s) => ({ localPRCache: { ...s.localPRCache, [projectId]: list } }))
    // Only swap the visible list if the update is for the active project.
    if (get().currentProjectId === projectId) {
      set({ localPRs: list, pullRequests: merge(get().remotePRs, list) })
    }
  },

  loadSeenPRs: async (projectId: string) => {
    const state = get()
    if (state.currentProjectId !== projectId) {
      const cached = state.seenCache[projectId]
      set({
        currentProjectId: projectId,
        seenPRs: cached ?? [],
      })
    }

    const fresh = await window.api.github.getSeenPRs(projectId)
    set((s) => ({ seenCache: { ...s.seenCache, [projectId]: fresh } }))

    if (get().currentProjectId === projectId) {
      set({ seenPRs: fresh })
    }
  },

  loadCurrentUser: async (repoPath: string) => {
    if (get().currentUser) return
    const login = await window.api.github.getCurrentUser(repoPath)
    if (login) set({ currentUser: login })
  },

  loadCollaborators: async (repoPath: string) => {
    const cached = get().collaboratorsCache[repoPath]
    if (cached) return cached
    const fresh = await window.api.github.listCollaborators(repoPath)
    set((s) => ({ collaboratorsCache: { ...s.collaboratorsCache, [repoPath]: fresh } }))
    return fresh
  },

  markSeen: (projectId: string, prNumber: number) => {
    set((state) => {
      if (state.seenPRs.includes(prNumber)) return state
      const seenPRs = [...state.seenPRs, prNumber]
      return {
        seenPRs,
        seenCache: { ...state.seenCache, [projectId]: seenPRs },
      }
    })
    window.api.github.markPRSeen(projectId, prNumber)
  },

  clear: () => {
    // Keep caches so toggling projects shows last-known state instantly.
    set({
      remotePRs: [],
      localPRs: [],
      pullRequests: [],
      seenPRs: [],
      loading: false,
      hasLoaded: false,
      currentRepoPath: null,
      currentProjectId: null,
    })
  },
}))
