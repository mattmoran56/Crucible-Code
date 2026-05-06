import { useEffect } from 'react'
import { useSchedulerStore } from '../stores/schedulerStore'
import { useSessionStore } from '../stores/sessionStore'
import { useProjectStore } from '../stores/projectStore'
import { useTerminalStore } from '../stores/terminalStore'
import { useToastStore } from '../stores/toastStore'
import type { QueuedSession, QueuedMessage, Session } from '../../shared/types'
import { formatClockTime } from '../lib/scheduleTime'

function sortByCreatedAtDesc(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}


/**
 * Fire a queued session. Exported for integration tests.
 *
 * Strategy — match the custom-button flow because that path is proven:
 *
 *   1. Create the worktree and persist the new session (so the sidebar
 *      reflects it next time the user looks at this project).
 *   2. Spawn claude via `window.api.button.execute(..., 'claude', 'terminal')`.
 *      This is the *exact* IPC handler the custom-button "claude / Terminal"
 *      flow uses — same spawn, same PTY shape, same hooks-free path.
 *   3. Inject the prompt via the button's `>`-detection-then-write helper
 *      (with MCP auto-confirm bolted on for any first-run permission prompts).
 *   4. Register the resulting terminal in `terminalStore` so when the user
 *      eventually clicks the session, `TerminalPanel` reuses this PTY rather
 *      than spawning a new claude.
 *
 * Notably this does NOT activate the new session in the workspace — the
 * user explicitly asked for queued sessions to run quietly in the
 * background and not yank their view away.
 */
export async function fireQueuedSession(item: QueuedSession): Promise<void> {
  const { projects } = useProjectStore.getState()
  const project = projects.find((p) => p.id === item.projectId)
  if (!project) {
    useToastStore.getState().addToast(
      'error',
      `Scheduled session "${item.name}" couldn't fire — its project is no longer registered.`
    )
    return
  }
  try {
    const worktreeInfo = await window.api.worktree.create(
      project.repoPath,
      item.name,
      item.baseBranch
    )
    const now = new Date().toISOString()
    const newSession: Session = {
      id: crypto.randomUUID(),
      name: item.name,
      branchName: worktreeInfo.branch,
      worktreePath: worktreeInfo.path,
      projectId: project.id,
      createdAt: now,
      lastActiveAt: now,
      baseBranch: item.baseBranch,
    }

    const existing = await window.api.session.list(project.id)
    const updated = sortByCreatedAtDesc([...existing, newSession])
    await window.api.session.save(project.id, updated)

    // Update the sidebar's session list ONLY for the project the user is
    // currently viewing — otherwise the next loadSessions call for that
    // project will pick up the new entry from disk. We deliberately do NOT
    // touch activeSessionId / activeWorkspaceTab / activeProjectId — the
    // user shouldn't have their workspace yanked over to the new session.
    const sessionState = useSessionStore.getState()
    if (sessionState.currentProjectId === project.id) {
      useSessionStore.setState({ sessions: updated })
    }

    if (!item.startupPrompt) {
      useToastStore.getState().addToast('success', `Started scheduled session "${item.name}"`)
      return
    }

    // Look up the project's claude account (if any) so the scheduled session
    // runs under the same login the user picked for this project.
    const account = useProjectStore
      .getState()
      .claudeAccounts.find((a) => a.id === project.claudeAccountId)

    // Spawn claude with the prompt piped via heredoc. Bulletproof — claude
    // reads the prompt from stdin before binding raw-mode TTY, processes it,
    // exits, and the mode='claude' auto-restart kicks in with --resume.
    const terminalId = await window.api.scheduler.spawnAgentWithPrompt(
      newSession.id,
      newSession.worktreePath,
      item.startupPrompt,
      'dark',
      account?.configDir,
      project.repoPath,
      newSession.id,
      'agent'
    )

    // Register the spawned terminal in the renderer's terminalStore so
    // `TerminalPanel`'s useEffect reuses this PTY when the user clicks
    // into the session, instead of spawning a second claude.
    useTerminalStore.setState((state) => ({
      terminals: {
        ...state.terminals,
        [`${newSession.id}:claude`]: {
          terminalId,
          sessionId: newSession.id,
          sessionName: newSession.name,
          mode: 'claude',
          contextId: newSession.id,
          tabId: 'agent',
        },
      },
    }))

    useToastStore.getState().addToast('success', `Started scheduled session "${item.name}"`)
  } catch (err) {
    useToastStore.getState().addToast(
      'error',
      `Failed to start scheduled session "${item.name}": ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

/**
 * Fire a queued message. Exported for integration tests.
 *
 * Same race-avoidance rationale as fireQueuedSession: setting the project
 * and calling loadSessions can lose to the Sidebar's effect-triggered
 * loadSessions, so we set sessionStore state directly with the persisted
 * list we just read.
 */
export async function fireQueuedMessage(item: QueuedMessage): Promise<void> {
  const allProjects = useProjectStore.getState().projects
  // We don't yet know which project the session belongs to without loading
  // — fall back to scanning persisted session lists. In practice the
  // session is in the currently-loaded list (the auto-continue toast only
  // fires for sessions the renderer has seen), but we handle the general
  // case for robustness.
  let session = useSessionStore.getState().sessions.find((s) => s.id === item.sessionId)
  let project = session ? allProjects.find((p) => p.id === session!.projectId) : null
  let projectSessions: Session[] | null = null

  if (!session) {
    for (const p of allProjects) {
      const list = await window.api.session.list(p.id)
      const match = list.find((s) => s.id === item.sessionId)
      if (match) {
        session = match
        project = p
        projectSessions = list
        break
      }
    }
  }

  if (!session || !project) {
    useToastStore.getState().addToast(
      'error',
      `Queued message couldn't fire — its session no longer exists.`
    )
    return
  }

  // If we found the session in the current store, use the existing list;
  // otherwise read the project's persisted list so we have a coherent set
  // for the state update.
  if (!projectSessions) {
    const current = useSessionStore.getState()
    projectSessions =
      current.currentProjectId === project.id
        ? current.sessions
        : await window.api.session.list(project.id)
  }

  const existingTerminal = useTerminalStore.getState().getTerminal(item.sessionId, 'claude')

  // Make sure the project's sessions list is in sync (so the user sees the
  // session if they navigate to that project), but don't switch their
  // active view.
  if (useSessionStore.getState().currentProjectId === project.id) {
    useSessionStore.setState({ sessions: projectSessions })
  }

  if (existingTerminal) {
    // Live PTY — give xterm a tick to focus, then write directly.
    setTimeout(() => {
      window.api.terminal.write(existingTerminal.terminalId, item.message + '\r')
    }, 200)
  } else {
    // No terminal yet — spawn one with the message piped in via heredoc.
    // Same bulletproof path the queued-session fire flow uses.
    try {
      const account = useProjectStore
        .getState()
        .claudeAccounts.find((a) => a.id === project!.claudeAccountId)
      const terminalId = await window.api.scheduler.spawnAgentWithPrompt(
        item.sessionId,
        session.worktreePath,
        item.message,
        'dark',
        account?.configDir,
        project!.repoPath,
        item.sessionId,
        'agent'
      )
      useTerminalStore.setState((state) => ({
        terminals: {
          ...state.terminals,
          [`${item.sessionId}:claude`]: {
            terminalId,
            sessionId: item.sessionId,
            sessionName: session.name,
            mode: 'claude',
            contextId: item.sessionId,
            tabId: 'agent',
          },
        },
      }))
    } catch (err) {
      useToastStore.getState().addToast(
        'error',
        `Failed to inject queued message: ${err instanceof Error ? err.message : String(err)}`
      )
      return
    }
  }

  useToastStore.getState().addToast('info', `Sent queued message to "${session.name}"`)
}

/**
 * Bootstraps the renderer-side scheduler:
 *  - hydrates queued sessions/messages from the main process on mount
 *  - subscribes to update broadcasts so the sidebar/toast stay in sync
 *  - subscribes to fire events and runs them
 *
 * Mount once at the top of the component tree.
 */
export function useSchedulerBootstrap(): void {
  const load = useSchedulerStore((s) => s.load)
  const setQueuedSessions = useSchedulerStore((s) => s.setQueuedSessions)
  const setQueuedMessages = useSchedulerStore((s) => s.setQueuedMessages)

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const offSessionsUpdate = window.api.scheduler.onQueuedSessionsUpdate((list) => {
      setQueuedSessions(list)
    })
    const offMessagesUpdate = window.api.scheduler.onQueuedMessagesUpdate((list) => {
      setQueuedMessages(list)
    })
    const offFireSession = window.api.scheduler.onFireQueuedSession((item) => {
      fireQueuedSession(item)
    })
    const offFireMessage = window.api.scheduler.onFireQueuedMessage((item) => {
      fireQueuedMessage(item)
    })
    return () => {
      offSessionsUpdate()
      offMessagesUpdate()
      offFireSession()
      offFireMessage()
    }
  }, [setQueuedSessions, setQueuedMessages])
}

/**
 * Helper used by both the Settings UI and the inline auto-continue toast.
 * Returns the chosen scheduledFor as a wall-clock label (e.g. "5:32 PM").
 */
export function describeScheduledFor(epochMs: number): string {
  return formatClockTime(epochMs)
}
