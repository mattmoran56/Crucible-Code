import { create } from 'zustand'
import type { Session, PullRequest } from '../../shared/types'
import { useToastStore } from './toastStore'

type WorkspaceTab = 'agent' | 'git' | 'pr'

interface DetachedWorktreeInfo {
  worktreePath: string
  branch: string
}

interface SessionState {
  sessions: Session[]
  staleSessions: Session[]
  activeSessionId: string | null
  activePRNumber: number | null
  activeWorkspaceTab: WorkspaceTab
  didStash: boolean
  detachedWorktree: DetachedWorktreeInfo | null
  loadSessions: (projectId: string) => Promise<void>
  createSession: (projectId: string, repoPath: string, name: string, baseBranch?: string) => Promise<void>
  removeSession: (projectId: string, repoPath: string, sessionId: string) => Promise<void>
  setActiveSession: (id: string) => Promise<void>
  setActiveWorkspaceTab: (tab: WorkspaceTab) => void
  openPR: (repoPath: string, pr: PullRequest) => Promise<void>
  closePR: () => Promise<void>
  checkStaleness: (repoPath: string) => Promise<void>
  reactivateSession: (projectId: string, sessionId: string) => Promise<void>
}

async function restoreDetachedWorktree(info: DetachedWorktreeInfo | null) {
  if (!info) return
  const { addToast } = useToastStore.getState()
  try {
    await window.api.git.restoreWorktree(info.worktreePath, info.branch)
  } catch (err) {
    addToast('error', `Failed to restore worktree branch: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  staleSessions: [],
  activeSessionId: null,
  activePRNumber: null,
  activeWorkspaceTab: 'agent' as WorkspaceTab,
  didStash: false,
  detachedWorktree: null,

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
      baseBranch,
    }

    const sessions = [...get().sessions, session]
    await window.api.session.save(projectId, sessions)
    await restoreDetachedWorktree(get().detachedWorktree)
    set({ sessions, activeSessionId: session.id, activePRNumber: null, activeWorkspaceTab: 'agent', detachedWorktree: null })
  },

  removeSession: async (projectId, repoPath, sessionId) => {
    const allSessions = [...get().sessions, ...get().staleSessions]
    const session = allSessions.find((s) => s.id === sessionId)
    if (session) {
      try {
        await window.api.worktree.remove(repoPath, session.worktreePath)
      } catch {
        // Worktree may already be removed
      }
    }

    const sessions = get().sessions.filter((s) => s.id !== sessionId)
    const staleSessions = get().staleSessions.filter((s) => s.id !== sessionId)
    await window.api.session.save(projectId, [...sessions, ...staleSessions])

    set({
      sessions,
      staleSessions,
      activeSessionId:
        get().activeSessionId === sessionId
          ? (sessions[0]?.id ?? null)
          : get().activeSessionId,
    })
  },

  checkStaleness: async (_repoPath: string) => {
    const { sessions, staleSessions } = get()
    const allSessions = [...sessions, ...staleSessions]
    const active: Session[] = []
    const stale: Session[] = []

    await Promise.all(
      allSessions.map(async (session) => {
        const merged = await window.api.git.isMerged(session.worktreePath, session.baseBranch ?? 'main')
        if (merged) {
          stale.push(session)
        } else {
          active.push(session)
        }
      })
    )

    set({ sessions: active, staleSessions: stale })
  },

  reactivateSession: async (projectId: string, sessionId: string) => {
    const session = get().staleSessions.find((s) => s.id === sessionId)
    if (!session) return
    const staleSessions = get().staleSessions.filter((s) => s.id !== sessionId)
    const sessions = [...get().sessions, session]
    await window.api.session.save(projectId, [...sessions, ...staleSessions])
    set({ sessions, staleSessions })
  },

  setActiveSession: async (id: string) => {
    await restoreDetachedWorktree(get().detachedWorktree)
    set({ activeSessionId: id, activePRNumber: null, activeWorkspaceTab: 'agent', didStash: false, detachedWorktree: null })
  },

  setActiveWorkspaceTab: (tab: WorkspaceTab) => {
    set({ activeWorkspaceTab: tab })
  },

  openPR: async (repoPath, pr) => {
    const { addToast } = useToastStore.getState()

    // Restore any previously detached worktree first
    await restoreDetachedWorktree(get().detachedWorktree)

    try {
      const { stashed, detachedWorktree, error } = await window.api.git.checkout(repoPath, pr.headRefName)
      if (error) {
        addToast('error', error)
      }
      set({
        activeSessionId: null,
        activePRNumber: pr.number,
        activeWorkspaceTab: 'pr',
        didStash: stashed,
        detachedWorktree: detachedWorktree
          ? { worktreePath: detachedWorktree, branch: pr.headRefName }
          : null,
      })
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : String(err))
      set({
        activeSessionId: null,
        activePRNumber: pr.number,
        activeWorkspaceTab: 'pr',
        didStash: false,
        detachedWorktree: null,
      })
    }
  },

  closePR: async () => {
    await restoreDetachedWorktree(get().detachedWorktree)
    set({ activePRNumber: null, detachedWorktree: null })
  },
}))
