import { create } from 'zustand'
import type { Session, PullRequest, WorktreeInfo } from '../../shared/types'
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
  clearActiveContext: () => Promise<void>
  checkStaleness: (repoPath: string) => Promise<void>
  markStale: (projectId: string, sessionId: string) => Promise<void>
  reactivateSession: (projectId: string, sessionId: string) => Promise<void>
  importWorktree: (projectId: string, worktree: WorktreeInfo) => Promise<void>
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
    const currentId = get().activeSessionId
    const stillExists = currentId && sessions.some((s) => s.id === currentId)
    set({
      sessions,
      staleSessions: [],
      activeSessionId: sessions.length > 0 ? (stillExists ? currentId : sessions[0].id) : null,
      // Reset workspace state so we don't carry over PR/git tab from previous project
      ...(!stillExists && {
        activePRNumber: null,
        activeWorkspaceTab: 'agent' as WorkspaceTab,
        didStash: false,
        detachedWorktree: null,
      }),
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
      lastActiveAt: new Date().toISOString(),
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
    const oneDayMs = 24 * 60 * 60 * 1000

    await Promise.all(
      allSessions.map(async (session) => {
        // Manually staled sessions stay stale
        if (session.staleAt) {
          stale.push(session)
          return
        }
        const withinOneDay = session.lastActiveAt
          ? Date.now() - new Date(session.lastActiveAt).getTime() < oneDayMs
          : false
        if (withinOneDay) {
          active.push(session)
          return
        }
        const merged = await window.api.git.isMerged(session.worktreePath, session.baseBranch ?? 'main')
        if (merged) {
          stale.push({ ...session, staleAt: session.staleAt ?? new Date().toISOString() })
        } else {
          active.push(session)
        }
      })
    )

    stale.sort((a, b) => new Date(b.staleAt!).getTime() - new Date(a.staleAt!).getTime())
    set({ sessions: active, staleSessions: stale })
  },

  markStale: async (projectId: string, sessionId: string) => {
    const session = get().sessions.find((s) => s.id === sessionId)
    if (!session) return
    const staled = { ...session, staleAt: new Date().toISOString() }
    const sessions = get().sessions.filter((s) => s.id !== sessionId)
    const staleSessions = [staled, ...get().staleSessions]
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

  reactivateSession: async (projectId: string, sessionId: string) => {
    const session = get().staleSessions.find((s) => s.id === sessionId)
    if (!session) return
    const reactivated = { ...session, lastActiveAt: new Date().toISOString(), staleAt: undefined }
    const staleSessions = get().staleSessions.filter((s) => s.id !== sessionId)
    const sessions = [...get().sessions, reactivated]
    await window.api.session.save(projectId, [...sessions, ...staleSessions])
    set({ sessions, staleSessions })
  },

  importWorktree: async (projectId, worktree) => {
    // Derive session name from the worktree directory name
    const segments = worktree.path.split('/')
    const name = segments[segments.length - 1] || worktree.branch

    const session: Session = {
      id: crypto.randomUUID(),
      name,
      branchName: worktree.branch,
      worktreePath: worktree.path,
      projectId,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    }

    const sessions = [...get().sessions, session]
    await window.api.session.save(projectId, sessions)
    await restoreDetachedWorktree(get().detachedWorktree)
    set({ sessions, activeSessionId: session.id, activePRNumber: null, activeWorkspaceTab: 'agent', detachedWorktree: null })
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

  clearActiveContext: async () => {
    await restoreDetachedWorktree(get().detachedWorktree)
    set({ activeSessionId: null, activePRNumber: null, activeWorkspaceTab: 'agent', didStash: false, detachedWorktree: null })
  },
}))
