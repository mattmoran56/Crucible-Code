import { create } from 'zustand'
import type { ClaudeWebSession } from '../../shared/types'

interface ClaudeWebState {
  sessions: ClaudeWebSession[]
  loading: boolean
  loadSessions: (
    repoPath: string,
    prefix: string | undefined,
    githubLogin: string | null
  ) => Promise<void>
  clear: () => void
}

export const useClaudeWebStore = create<ClaudeWebState>((set) => ({
  sessions: [],
  loading: false,

  loadSessions: async (repoPath, prefix, githubLogin) => {
    set({ loading: true })
    try {
      const sessions = await window.api.claudeWeb.listSessions(repoPath, prefix, githubLogin)
      set({ sessions, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  clear: () => set({ sessions: [], loading: false }),
}))
