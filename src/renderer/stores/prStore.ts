import { create } from 'zustand'
import type { PullRequest, GitHubCollaborator } from '../../shared/types'

interface PRState {
  // Per-repo / per-project caches so toggling between projects shows the
  // last-known state instantly instead of flashing empty until the gh fetch
  // returns. Keys: prCache[repoPath], seenCache[projectId].
  prCache: Record<string, PullRequest[]>
  seenCache: Record<string, number[]>
  collaboratorsCache: Record<string, GitHubCollaborator[]>
  // Tracks which repo/project the visible state belongs to, so a slow
  // background fetch can't overwrite the displayed PRs after the user has
  // already switched to a different project.
  currentRepoPath: string | null
  currentProjectId: string | null
  pullRequests: PullRequest[]
  seenPRs: number[]
  loading: boolean
  hasLoaded: boolean
  currentUser: string | null
  loadPRs: (repoPath: string) => Promise<void>
  loadSeenPRs: (projectId: string) => Promise<void>
  loadCurrentUser: (repoPath: string) => Promise<void>
  loadCollaborators: (repoPath: string) => Promise<GitHubCollaborator[]>
  markSeen: (projectId: string, prNumber: number) => void
  clear: () => void
}

export const usePRStore = create<PRState>((set, get) => ({
  prCache: {},
  seenCache: {},
  collaboratorsCache: {},
  currentRepoPath: null,
  currentProjectId: null,
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
        pullRequests: cached ?? [],
        loading: !cached,
        hasLoaded: !!cached,
      })
    }

    const fresh = await window.api.github.listPRs(repoPath)
    set((s) => ({ prCache: { ...s.prCache, [repoPath]: fresh } }))

    if (get().currentRepoPath === repoPath) {
      set({ pullRequests: fresh, loading: false, hasLoaded: true })
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
      pullRequests: [],
      seenPRs: [],
      loading: false,
      hasLoaded: false,
      currentRepoPath: null,
      currentProjectId: null,
    })
  },
}))
