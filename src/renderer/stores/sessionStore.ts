import { create } from 'zustand'
import type { Session } from '../../shared/types'

interface SessionState {
  sessions: Session[]
  activeSessionId: string | null
  loadSessions: (projectId: string) => Promise<void>
  createSession: (projectId: string, repoPath: string, name: string, baseBranch?: string) => Promise<void>
  removeSession: (projectId: string, repoPath: string, sessionId: string) => Promise<void>
  setActiveSession: (id: string) => void
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  activeSessionId: null,

  loadSessions: async (projectId: string) => {
    const sessions = await window.api.session.list(projectId)
    set({
      sessions,
      activeSessionId: sessions.length > 0 ? (get().activeSessionId ?? sessions[0].id) : null,
    })
  },

  createSession: async (projectId, repoPath, name, baseBranch) => {
    const worktreeInfo = await window.api.worktree.create(repoPath, name, baseBranch)
    const session: Session = {
      id: crypto.randomUUID(),
      name,
      branchName: worktreeInfo.branch,
      worktreePath: worktreeInfo.path,
      projectId,
      createdAt: new Date().toISOString(),
    }

    const sessions = [...get().sessions, session]
    await window.api.session.save(projectId, sessions)
    set({ sessions, activeSessionId: session.id })
  },

  removeSession: async (projectId, repoPath, sessionId) => {
    const session = get().sessions.find((s) => s.id === sessionId)
    if (session) {
      try {
        await window.api.worktree.remove(repoPath, session.worktreePath)
      } catch {
        // Worktree may already be removed
      }
    }

    const sessions = get().sessions.filter((s) => s.id !== sessionId)
    await window.api.session.save(projectId, sessions)

    set({
      sessions,
      activeSessionId:
        get().activeSessionId === sessionId
          ? (sessions[0]?.id ?? null)
          : get().activeSessionId,
    })
  },

  setActiveSession: (id: string) => {
    set({ activeSessionId: id })
  },
}))
