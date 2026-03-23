import { create } from 'zustand'
import type { Session, PullRequest } from '../../shared/types'

type WorkspaceTab = 'agent' | 'git'

interface SessionState {
  sessions: Session[]
  activeSessionId: string | null
  activeWorkspaceTab: WorkspaceTab
  loadSessions: (projectId: string) => Promise<void>
  createSession: (projectId: string, repoPath: string, name: string, baseBranch?: string) => Promise<void>
  createSessionForPR: (projectId: string, repoPath: string, pr: PullRequest) => Promise<void>
  removeSession: (projectId: string, repoPath: string, sessionId: string) => Promise<void>
  setActiveSession: (id: string) => void
  setActiveWorkspaceTab: (tab: WorkspaceTab) => void
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  activeWorkspaceTab: 'agent' as WorkspaceTab,

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

  createSessionForPR: async (projectId, repoPath, pr) => {
    // If a session already exists for this branch, just activate it
    const existing = get().sessions.find((s) => s.branchName === pr.headRefName)
    if (existing) {
      set({ activeSessionId: existing.id, activeWorkspaceTab: 'git' })
      return
    }

    const sessionName = `pr-${pr.number}`
    const wtInfo = await window.api.worktree.createFromBranch(repoPath, sessionName, pr.headRefName)
    const session: Session = {
      id: crypto.randomUUID(),
      name: `PR #${pr.number}: ${pr.title}`,
      branchName: wtInfo.branch,
      worktreePath: wtInfo.path,
      projectId,
      createdAt: new Date().toISOString(),
    }

    const sessions = [...get().sessions, session]
    await window.api.session.save(projectId, sessions)
    set({ sessions, activeSessionId: session.id, activeWorkspaceTab: 'git' })
  },

  setActiveSession: (id: string) => {
    set({ activeSessionId: id })
  },

  setActiveWorkspaceTab: (tab: WorkspaceTab) => {
    set({ activeWorkspaceTab: tab })
  },
}))
