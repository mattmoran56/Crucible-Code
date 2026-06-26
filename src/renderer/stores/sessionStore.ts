import { create } from 'zustand'
import type { Session, PullRequest, WorktreeInfo, NotionTicketLink } from '../../shared/types'
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
  prWorktreePath: string | null
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
  currentProjectId: string | null
  activeSessionId: string | null
  activePRNumber: number | null
  /** Worktree path for the currently-open PR, if any. PR reviews now happen in a dedicated worktree at `<wtBase>/pr-<num>` rather than by checking the branch out in the main repo. */
  activePRWorktreePath: string | null
  activeWorkspaceTab: WorkspaceTab
  didStash: boolean
  detachedWorktree: DetachedWorktreeInfo | null
  openedAsMainBranch: string | null
  previousMainBranch: string | null
  /** A startup command queued by createSession, consumed by the agent terminal once it spawns. */
  pendingStartup: { sessionId: string; command: string } | null
  /** A session whose agent xterm should auto-focus on first attach, consumed by useTerminal. */
  pendingFocusSessionId: string | null
  loadSessions: (projectId: string) => Promise<void>
  createSession: (projectId: string, repoPath: string, name: string, baseBranch?: string, startupCommand?: string, notionTicket?: NotionTicketLink) => Promise<void>
  removeSession: (projectId: string, repoPath: string, sessionId: string) => Promise<void>
  renameSession: (projectId: string, repoPath: string, sessionId: string, newName: string) => Promise<void>
  /** Toggle whether this session's terminals capture `gh pr create` into a local PR. */
  setSessionCaptureLocalPr: (projectId: string, sessionId: string, enabled: boolean) => Promise<void>
  setActiveSession: (id: string, repoPath?: string) => Promise<void>
  setActiveWorkspaceTab: (tab: WorkspaceTab) => void
  openPR: (repoPath: string, pr: PullRequest) => Promise<void>
  closePR: () => Promise<void>
  /** Called by the PR poll loop to tear down worktrees for PRs no longer open. */
  reconcilePRWorktrees: (repoPath: string, openPRNumbers: number[]) => Promise<void>
  openAsMainBranch: (repoPath: string, sessionId: string) => Promise<void>
  returnToWorktree: (repoPath: string) => Promise<void>
  clearActiveContext: () => Promise<void>
  openBranch: (projectId: string, repoPath: string, branch: string, sessionName: string) => Promise<void>
  importWorktree: (projectId: string, worktree: WorktreeInfo) => Promise<void>
  consumePendingStartup: (sessionId: string) => string | null
  consumePendingFocus: (sessionId: string) => boolean
  queuePendingStartup: (sessionId: string, command: string) => void
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
  currentProjectId: null,
  activeSessionId: null,
  activePRNumber: null,
  activePRWorktreePath: null,
  activeWorkspaceTab: 'agent' as WorkspaceTab,
  didStash: false,
  detachedWorktree: null,
  openedAsMainBranch: null,
  previousMainBranch: null,
  pendingStartup: null,
  pendingFocusSessionId: null,

  loadSessions: async (projectId: string) => {
    // Save current context for the project we're leaving
    const prevProjectId = get().currentProjectId
    if (prevProjectId && prevProjectId !== projectId) {
      saveLastActiveContext(prevProjectId, {
        sessionId: get().activeSessionId,
        prNumber: get().activePRNumber,
        prWorktreePath: get().activePRWorktreePath,
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
    let activePRWorktreePath: string | null = null
    let activeWorkspaceTab: WorkspaceTab = 'agent'

    if (stillExists) {
      // Same project reload — keep current selection
      activeSessionId = currentId
      activePRNumber = get().activePRNumber
      activePRWorktreePath = get().activePRWorktreePath
      activeWorkspaceTab = get().activeWorkspaceTab
    } else if (savedSessionExists || savedPRExists) {
      // Returning to a project — restore last active context
      activeSessionId = savedSessionExists ? saved!.sessionId : null
      activePRNumber = saved!.prNumber
      activePRWorktreePath = saved!.prWorktreePath ?? null
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
      currentProjectId: projectId,
      activeSessionId,
      activePRNumber,
      activePRWorktreePath,
      activeWorkspaceTab,
      openedAsMainBranch,
      previousMainBranch,
      detachedWorktree,
      didStash,
    })
  },

  createSession: async (projectId, repoPath, name, baseBranch, startupCommand, notionTicket) => {
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
      notionTicket,
    }

    const sessions = sortByCreatedAtDesc([...get().sessions, session])
    await window.api.session.save(projectId, sessions)
    if (get().currentProjectId !== projectId) return
    await restoreDetachedWorktree(get().detachedWorktree)
    set({
      sessions,
      activeSessionId: session.id,
      activePRNumber: null,
      activePRWorktreePath: null,
      activeWorkspaceTab: 'agent',
      detachedWorktree: null,
      pendingStartup: startupCommand ? { sessionId: session.id, command: startupCommand } : null,
      pendingFocusSessionId: session.id,
    })
    saveLastActiveContext(projectId, { sessionId: session.id, prNumber: null, prWorktreePath: null, openedAsMainBranch: null, previousMainBranch: null, detachedWorktree: null, didStash: false })
  },

  consumePendingStartup: (sessionId: string) => {
    const pending = get().pendingStartup
    if (!pending || pending.sessionId !== sessionId) return null
    set({ pendingStartup: null })
    return pending.command
  },

  consumePendingFocus: (sessionId: string) => {
    if (get().pendingFocusSessionId !== sessionId) return false
    set({ pendingFocusSessionId: null })
    return true
  },

  queuePendingStartup: (sessionId: string, command: string) => {
    set({ pendingStartup: { sessionId, command } })
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

    // Clean up all terminals for this session (both renderer xterm instances and main PTY processes)
    await useTerminalStore.getState().killAllForSession(sessionId)
    await window.api.terminal.killSession(sessionId)

    const sessions = get().sessions.filter((s) => s.id !== sessionId)
    await window.api.session.save(projectId, sessions)
    if (get().currentProjectId !== projectId) return

    set({
      sessions,
      activeSessionId:
        get().activeSessionId === sessionId
          ? (sessions[0]?.id ?? null)
          : get().activeSessionId,
    })
  },

  renameSession: async (projectId, repoPath, sessionId, newName) => {
    const trimmed = newName.trim()
    if (!trimmed) throw new Error('Name cannot be empty')
    if (!/^[A-Za-z0-9._/-]+$/.test(trimmed)) {
      throw new Error('Name can only contain letters, numbers, dots, dashes, underscores and slashes')
    }
    const session = get().sessions.find((s) => s.id === sessionId)
    if (!session) throw new Error('Session not found')
    if (session.name === trimmed) return
    if (get().sessions.some((s) => s.id !== sessionId && s.name === trimmed)) {
      throw new Error('Another session already uses this name')
    }

    const desiredBranch = `session/${trimmed}`
    const { newBranch } = await window.api.worktree.renameBranch(
      repoPath,
      session.worktreePath,
      session.branchName,
      desiredBranch
    )

    const sessions = get().sessions.map((s) =>
      s.id === sessionId ? { ...s, name: trimmed, branchName: newBranch } : s
    )
    await window.api.session.save(projectId, sessions)
    if (get().currentProjectId !== projectId) return
    set({ sessions })
  },

  setSessionCaptureLocalPr: async (projectId, sessionId, enabled) => {
    const sessions = get().sessions.map((s) =>
      s.id === sessionId ? { ...s, captureLocalPr: enabled } : s
    )
    await window.api.session.save(projectId, sessions)
    if (get().currentProjectId === projectId) set({ sessions })
    // Capture is keyed by contextId, which is the session id for sessions.
    await window.api.localPr.setCapture(sessionId, enabled)
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
    set({ sessions, activeSessionId: session.id, activePRNumber: null, activePRWorktreePath: null, activeWorkspaceTab: 'agent', detachedWorktree: null })
    saveLastActiveContext(projectId, { sessionId: session.id, prNumber: null, prWorktreePath: null, openedAsMainBranch: null, previousMainBranch: null, detachedWorktree: null, didStash: false })
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
    set({ sessions, activeSessionId: session.id, activePRNumber: null, activePRWorktreePath: null, activeWorkspaceTab: 'agent', detachedWorktree: null })
    saveLastActiveContext(projectId, { sessionId: session.id, prNumber: null, prWorktreePath: null, openedAsMainBranch: null, previousMainBranch: null, detachedWorktree: null, didStash: false })
  },

  setActiveSession: async (id: string, repoPath?: string) => {
    const { openedAsMainBranch } = get()
    // If a session is opened as main branch, preserve that state —
    // don't restore the worktree or undo the checkout until the user
    // explicitly clicks "Return to worktree".
    if (openedAsMainBranch) {
      set({ activeSessionId: id, activePRNumber: null, activePRWorktreePath: null, activeWorkspaceTab: 'agent' })
    } else {
      const { detachedWorktree } = get()
      await restoreDetachedWorktree(detachedWorktree)
      set({ activeSessionId: id, activePRNumber: null, activePRWorktreePath: null, activeWorkspaceTab: 'agent', didStash: false, detachedWorktree: null })
    }
    const projectId = get().currentProjectId
    if (projectId) saveLastActiveContext(projectId, {
      sessionId: id,
      prNumber: null,
      prWorktreePath: null,
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

    // Switch UI immediately so the user sees the PR view without waiting for
    // the worktree creation. Worktree path is filled in once the IPC resolves.
    set({
      activeSessionId: null,
      activePRNumber: pr.number,
      activePRWorktreePath: null,
      activeWorkspaceTab: 'pr',
      didStash: false,
      detachedWorktree: null,
    })

    let worktreePath: string | null = null
    try {
      const info = await window.api.worktree.createForPR(repoPath, pr.number, pr.headRefName)
      worktreePath = info.path
    } catch (err) {
      addToast('error', `Failed to open PR worktree: ${err instanceof Error ? err.message : String(err)}`)
    }

    // The user may have navigated away while the worktree was being created;
    // only commit the path back to state if they're still on this PR.
    if (get().activePRNumber === pr.number) {
      set({ activePRWorktreePath: worktreePath })
    }

    const projectId = get().currentProjectId
    if (projectId) saveLastActiveContext(projectId, {
      sessionId: null,
      prNumber: pr.number,
      prWorktreePath: worktreePath,
      openedAsMainBranch: get().openedAsMainBranch,
      previousMainBranch: get().previousMainBranch,
      detachedWorktree: get().detachedWorktree,
      didStash: get().didStash,
    })
  },

  closePR: async () => {
    // Leave the worktree alone — it stays until the PR is merged/closed and
    // the poll-driven reconcile path tears it down.
    set({ activePRNumber: null, activePRWorktreePath: null })
    const projectId = get().currentProjectId
    if (projectId) saveLastActiveContext(projectId, { sessionId: get().activeSessionId, prNumber: null, prWorktreePath: null, openedAsMainBranch: get().openedAsMainBranch, previousMainBranch: get().previousMainBranch, detachedWorktree: get().detachedWorktree, didStash: get().didStash })
  },

  reconcilePRWorktrees: async (repoPath, openPRNumbers) => {
    let existing: Array<{ prNumber: number; path: string; branch: string | null }>
    try {
      existing = await window.api.worktree.listPR(repoPath)
    } catch {
      return
    }
    const openSet = new Set(openPRNumbers)
    const stale = existing.filter((w) => !openSet.has(w.prNumber))
    if (stale.length === 0) return

    await Promise.all(stale.map(async (w) => {
      try {
        await window.api.worktree.removePR(repoPath, w.prNumber)
      } catch {
        // Best-effort; will retry on next poll.
      }
    }))

    // If the active PR was torn down, clear it so the user isn't stuck on a
    // stale view.
    const activePR = get().activePRNumber
    if (activePR != null && stale.some((w) => w.prNumber === activePR)) {
      set({ activePRNumber: null, activePRWorktreePath: null, activeWorkspaceTab: 'agent' })
      const projectId = get().currentProjectId
      if (projectId) saveLastActiveContext(projectId, { sessionId: get().activeSessionId, prNumber: null, prWorktreePath: null, openedAsMainBranch: get().openedAsMainBranch, previousMainBranch: get().previousMainBranch, detachedWorktree: get().detachedWorktree, didStash: get().didStash })
    }
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
    set({ activeSessionId: null, activePRNumber: null, activePRWorktreePath: null, activeWorkspaceTab: 'agent', didStash: false, detachedWorktree: null, openedAsMainBranch: null, previousMainBranch: null })
    const projectId = get().currentProjectId
    if (projectId) saveLastActiveContext(projectId, { sessionId: null, prNumber: null, prWorktreePath: null, openedAsMainBranch: null, previousMainBranch: null, detachedWorktree: null, didStash: false })
  },
}))
