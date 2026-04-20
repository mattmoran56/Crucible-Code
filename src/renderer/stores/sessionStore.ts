import { create } from 'zustand'
import type { Session, PullRequest, WorktreeInfo } from '../../shared/types'
import { useToastStore } from './toastStore'
import { useTerminalStore } from './terminalStore'

type WorkspaceTab = 'agent' | 'git' | 'pr'

interface DetachedWorktreeInfo {
  worktreePath: string
  branch: string
}

interface PerProjectContext {
  sessionId: string | null
  prNumber: number | null
  openedAsMainBranch: string | null
  previousMainBranch: string | null
  detachedWorktree: DetachedWorktreeInfo | null
  didStash: boolean
}

// Fire-and-forget save to electron-store (crash-safe)
function saveLastActiveContext(projectId: string, context: PerProjectContext) {
  window.api.session.saveContext(projectId, context as unknown as Record<string, unknown>)
}

async function getLastActiveContext(projectId: string): Promise<PerProjectContext | null> {
  const raw = await window.api.session.getContext(projectId)
  return (raw as PerProjectContext | null) ?? null
}

interface SessionState {
  sessions: Session[]
  staleSessions: Session[]
  currentProjectId: string | null
  activeSessionId: string | null
  activePRNumber: number | null
  activeWorkspaceTab: WorkspaceTab
  didStash: boolean
  detachedWorktree: DetachedWorktreeInfo | null
  openedAsMainBranch: string | null
  previousMainBranch: string | null
  loadSessions: (projectId: string) => Promise<void>
  createSession: (projectId: string, repoPath: string, name: string, baseBranch?: string) => Promise<void>
  removeSession: (projectId: string, repoPath: string, sessionId: string) => Promise<void>
  setActiveSession: (id: string, repoPath?: string) => Promise<void>
  setActiveWorkspaceTab: (tab: WorkspaceTab) => void
  openPR: (repoPath: string, pr: PullRequest) => Promise<void>
  closePR: () => Promise<void>
  openAsMainBranch: (repoPath: string, sessionId: string) => Promise<void>
  returnToWorktree: (repoPath: string) => Promise<void>
  clearActiveContext: () => Promise<void>
  checkStaleness: (repoPath: string) => Promise<void>
  markStale: (projectId: string, sessionId: string) => Promise<void>
  reactivateSession: (projectId: string, sessionId: string) => Promise<void>
  openBranch: (projectId: string, repoPath: string, branch: string, sessionName: string) => Promise<void>
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

// Sort sessions by createdAt descending (newest first) for stable display order
function sortByCreatedAtDesc(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

let loadSessionsRequestId = 0

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  staleSessions: [],
  currentProjectId: null,
  activeSessionId: null,
  activePRNumber: null,
  activeWorkspaceTab: 'agent' as WorkspaceTab,
  didStash: false,
  detachedWorktree: null,
  openedAsMainBranch: null,
  previousMainBranch: null,

  loadSessions: async (projectId: string) => {
    // Save current context for the project we're leaving
    const prevProjectId = get().currentProjectId
    if (prevProjectId && prevProjectId !== projectId) {
      saveLastActiveContext(prevProjectId, {
        sessionId: get().activeSessionId,
        prNumber: get().activePRNumber,
        openedAsMainBranch: get().openedAsMainBranch,
        previousMainBranch: get().previousMainBranch,
        detachedWorktree: get().detachedWorktree,
        didStash: get().didStash,
      })
    }

    const thisRequestId = ++loadSessionsRequestId
    const sessions = sortByCreatedAtDesc(await window.api.session.list(projectId))
    if (thisRequestId !== loadSessionsRequestId) return  // stale response, discard
    const currentId = get().activeSessionId
    const stillExists = currentId && sessions.some((s) => s.id === currentId)

    // Check for a previously saved context for this project
    const saved = await getLastActiveContext(projectId)
    const savedSessionExists = saved?.sessionId && sessions.some((s) => s.id === saved.sessionId)
    const savedPRExists = saved?.prNumber != null

    let activeSessionId: string | null
    let activePRNumber: number | null = null
    let activeWorkspaceTab: WorkspaceTab = 'agent'

    if (stillExists) {
      // Same project reload — keep current selection
      activeSessionId = currentId
      activePRNumber = get().activePRNumber
      activeWorkspaceTab = get().activeWorkspaceTab
    } else if (savedSessionExists || savedPRExists) {
      // Returning to a project — restore last active context
      activeSessionId = savedSessionExists ? saved!.sessionId : null
      activePRNumber = saved!.prNumber
      activeWorkspaceTab = saved!.prNumber ? 'pr' : 'agent'
    } else {
      // Fallback to first session
      activeSessionId = sessions.length > 0 ? sessions[0].id : null
    }

    // Restore or clear main-branch state
    let openedAsMainBranch: string | null = null
    let previousMainBranch: string | null = null
    let detachedWorktree: DetachedWorktreeInfo | null = null
    let didStash = false

    if (stillExists) {
      // Same project reload — keep current state
      openedAsMainBranch = get().openedAsMainBranch
      previousMainBranch = get().previousMainBranch
      detachedWorktree = get().detachedWorktree
      didStash = get().didStash
    } else if (saved) {
      // Returning to a project — restore saved main-branch state
      openedAsMainBranch = saved.openedAsMainBranch ?? null
      previousMainBranch = saved.previousMainBranch ?? null
      detachedWorktree = saved.detachedWorktree ?? null
      didStash = saved.didStash ?? false
    }

    set({
      sessions,
      staleSessions: [],
      currentProjectId: projectId,
      activeSessionId,
      activePRNumber,
      activeWorkspaceTab,
      openedAsMainBranch,
      previousMainBranch,
      detachedWorktree,
      didStash,
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

    const sessions = sortByCreatedAtDesc([...get().sessions, session])
    await window.api.session.save(projectId, sessions)
    if (get().currentProjectId !== projectId) return
    await restoreDetachedWorktree(get().detachedWorktree)
    set({ sessions, activeSessionId: session.id, activePRNumber: null, activeWorkspaceTab: 'agent', detachedWorktree: null })
    saveLastActiveContext(projectId, { sessionId: session.id, prNumber: null, openedAsMainBranch: null, previousMainBranch: null, detachedWorktree: null, didStash: false })
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

    // Clean up all terminals for this session (both renderer xterm instances and main PTY processes)
    await useTerminalStore.getState().killAllForSession(sessionId)
    await window.api.terminal.killSession(sessionId)

    const sessions = get().sessions.filter((s) => s.id !== sessionId)
    const staleSessions = get().staleSessions.filter((s) => s.id !== sessionId)
    await window.api.session.save(projectId, [...sessions, ...staleSessions])
    if (get().currentProjectId !== projectId) return

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
    set({ sessions: sortByCreatedAtDesc(active), staleSessions: stale })
  },

  markStale: async (projectId: string, sessionId: string) => {
    const session = get().sessions.find((s) => s.id === sessionId)
    if (!session) return
    const staled = { ...session, staleAt: new Date().toISOString() }
    const sessions = get().sessions.filter((s) => s.id !== sessionId)
    const staleSessions = [staled, ...get().staleSessions]
    await window.api.session.save(projectId, [...sessions, ...staleSessions])
    if (get().currentProjectId !== projectId) return
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
    const sessions = sortByCreatedAtDesc([...get().sessions, reactivated])
    await window.api.session.save(projectId, [...sessions, ...staleSessions])
    if (get().currentProjectId !== projectId) return
    set({ sessions, staleSessions })
  },

  openBranch: async (projectId, repoPath, branch, sessionName) => {
    const worktreeInfo = await window.api.worktree.createFromBranch(repoPath, sessionName, branch)
    const session: Session = {
      id: crypto.randomUUID(),
      name: sessionName,
      branchName: worktreeInfo.branch,
      worktreePath: worktreeInfo.path,
      projectId,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    }

    const sessions = sortByCreatedAtDesc([...get().sessions, session])
    await window.api.session.save(projectId, sessions)
    if (get().currentProjectId !== projectId) return
    await restoreDetachedWorktree(get().detachedWorktree)
    set({ sessions, activeSessionId: session.id, activePRNumber: null, activeWorkspaceTab: 'agent', detachedWorktree: null })
    saveLastActiveContext(projectId, { sessionId: session.id, prNumber: null, openedAsMainBranch: null, previousMainBranch: null, detachedWorktree: null, didStash: false })
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

    const sessions = sortByCreatedAtDesc([...get().sessions, session])
    await window.api.session.save(projectId, sessions)
    if (get().currentProjectId !== projectId) return
    await restoreDetachedWorktree(get().detachedWorktree)
    set({ sessions, activeSessionId: session.id, activePRNumber: null, activeWorkspaceTab: 'agent', detachedWorktree: null })
    saveLastActiveContext(projectId, { sessionId: session.id, prNumber: null, openedAsMainBranch: null, previousMainBranch: null, detachedWorktree: null, didStash: false })
  },

  setActiveSession: async (id: string, repoPath?: string) => {
    const { openedAsMainBranch } = get()
    // If a session is opened as main branch, preserve that state —
    // don't restore the worktree or undo the checkout until the user
    // explicitly clicks "Return to worktree".
    if (openedAsMainBranch) {
      set({ activeSessionId: id, activePRNumber: null, activeWorkspaceTab: 'agent' })
    } else {
      const { detachedWorktree } = get()
      await restoreDetachedWorktree(detachedWorktree)
      set({ activeSessionId: id, activePRNumber: null, activeWorkspaceTab: 'agent', didStash: false, detachedWorktree: null })
    }
    const projectId = get().currentProjectId
    if (projectId) saveLastActiveContext(projectId, {
      sessionId: id,
      prNumber: null,
      openedAsMainBranch: get().openedAsMainBranch,
      previousMainBranch: get().previousMainBranch,
      detachedWorktree: get().detachedWorktree,
      didStash: get().didStash,
    })
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
    const projectId = get().currentProjectId
    if (projectId) saveLastActiveContext(projectId, { sessionId: null, prNumber: pr.number, openedAsMainBranch: get().openedAsMainBranch, previousMainBranch: get().previousMainBranch, detachedWorktree: get().detachedWorktree, didStash: get().didStash })
  },

  closePR: async () => {
    await restoreDetachedWorktree(get().detachedWorktree)
    set({ activePRNumber: null, detachedWorktree: null })
    const projectId = get().currentProjectId
    if (projectId) saveLastActiveContext(projectId, { sessionId: get().activeSessionId, prNumber: null, openedAsMainBranch: get().openedAsMainBranch, previousMainBranch: get().previousMainBranch, detachedWorktree: get().detachedWorktree, didStash: get().didStash })
  },

  openAsMainBranch: async (repoPath, sessionId) => {
    const { addToast } = useToastStore.getState()

    // Restore any previously detached worktree first
    await restoreDetachedWorktree(get().detachedWorktree)

    const session = get().sessions.find((s) => s.id === sessionId)
    if (!session) return

    try {
      // Remember what branch main repo is on so we can restore later
      const status = await window.api.git.status(repoPath)
      const previousBranch = status.current ?? null

      const { stashed, detachedWorktree, error } = await window.api.git.checkout(repoPath, session.branchName)
      if (error) {
        addToast('error', error)
      }
      set({
        activeSessionId: sessionId,
        activePRNumber: null,
        openedAsMainBranch: sessionId,
        previousMainBranch: previousBranch,
        didStash: stashed,
        detachedWorktree: detachedWorktree
          ? { worktreePath: detachedWorktree, branch: session.branchName }
          : null,
      })
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : String(err))
    }
  },

  returnToWorktree: async (repoPath) => {
    const { addToast } = useToastStore.getState()
    const { detachedWorktree, previousMainBranch } = get()

    // Put main repo back on its original branch FIRST to free the session branch
    if (previousMainBranch) {
      try {
        await window.api.git.checkout(repoPath, previousMainBranch)
      } catch (err) {
        addToast('error', `Failed to restore main branch: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // Now the session branch is free — restore it on the worktree
    await restoreDetachedWorktree(detachedWorktree)

    set({
      openedAsMainBranch: null,
      previousMainBranch: null,
      detachedWorktree: null,
      didStash: false,
    })
  },

  clearActiveContext: async () => {
    await restoreDetachedWorktree(get().detachedWorktree)
    set({ activeSessionId: null, activePRNumber: null, activeWorkspaceTab: 'agent', didStash: false, detachedWorktree: null, openedAsMainBranch: null, previousMainBranch: null })
    const projectId = get().currentProjectId
    if (projectId) saveLastActiveContext(projectId, { sessionId: null, prNumber: null, openedAsMainBranch: null, previousMainBranch: null, detachedWorktree: null, didStash: false })
  },
}))
