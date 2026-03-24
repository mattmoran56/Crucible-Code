import { create } from 'zustand'
import type { PullRequest } from '../../shared/types'

interface PRState {
  pullRequests: PullRequest[]
  seenPRs: number[]
  loading: boolean
  hasLoaded: boolean
  loadPRs: (repoPath: string) => Promise<void>
  loadSeenPRs: (projectId: string) => Promise<void>
  markSeen: (projectId: string, prNumber: number) => void
  clear: () => void
}

export const usePRStore = create<PRState>((set, get) => ({
  pullRequests: [],
  seenPRs: [],
  loading: false,
  hasLoaded: false,

  loadPRs: async (repoPath: string) => {
    if (!get().hasLoaded) {
      set({ loading: true })
    }
    const pullRequests = await window.api.github.listPRs(repoPath)
    set({ pullRequests, loading: false, hasLoaded: true })
  },

  loadSeenPRs: async (projectId: string) => {
    const seenPRs = await window.api.github.getSeenPRs(projectId)
    set({ seenPRs })
  },

  markSeen: (projectId: string, prNumber: number) => {
    const { seenPRs } = get()
    if (!seenPRs.includes(prNumber)) {
      set({ seenPRs: [...seenPRs, prNumber] })
    }
    window.api.github.markPRSeen(projectId, prNumber)
  },

  clear: () => {
    set({ pullRequests: [], seenPRs: [], loading: false, hasLoaded: false })
  },
}))
