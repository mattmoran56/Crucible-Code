import { useEffect } from 'react'
import { useSchedulerStore } from '../stores/schedulerStore'
import { useSessionStore } from '../stores/sessionStore'
import { useProjectStore } from '../stores/projectStore'
import { useToastStore } from '../stores/toastStore'
import type { QueuedSession, QueuedMessage, Session } from '../../shared/types'
import { formatClockTime } from '../lib/scheduleTime'
import { startSessionVisualAgent } from '../lib/startVisualAgent'
import { projectConfigDir } from '../lib/visualAgents'

function sortByCreatedAtDesc(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}


/**
 * Fire a queued session. Exported for integration tests.
 *
 * Strategy:
 *
 *   1. Create the worktree and persist the new session (so the sidebar
 *      reflects it next time the user looks at this project).
 *   2. Start the session's Agent tab visual agent with the startup prompt as
 *      its first message. When the user eventually clicks the session, the
 *      Agent tab attaches to this running agent rather than starting another.
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

    // Quiet-created sessions don't pass through the App.tsx / SessionSidebar
    // render paths that call registerSession, so the notification routing for
    // their hook events would be dropped. Register explicitly.
    try {
      await window.api.notification.registerSession(
        newSession.id,
        newSession.name,
        project.id,
        newSession.worktreePath
      )
    } catch {
      // Best-effort
    }

    if (!item.startupPrompt) {
      useToastStore.getState().addToast('success', `Started scheduled session "${item.name}"`)
      return
    }

    // Runs under the project's claude account, like every visual agent.
    await startSessionVisualAgent(newSession, project, item.startupPrompt)

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

  // Make sure the project's sessions list is in sync (so the user sees the
  // session if they navigate to that project), but don't switch their
  // active view.
  if (useSessionStore.getState().currentProjectId === project.id) {
    useSessionStore.setState({ sessions: projectSessions })
  }

  const cloud = session.location === 'cloud' ? session.cloud : undefined
  try {
    if (cloud) {
      // A cloud session has no local agent: queue the message to the Claude
      // Code on the web session itself (`claude -p <msg> --cloud <id>`).
      await window.api.cloudSession.send({
        worktreePath: session.worktreePath,
        cloudSessionId: cloud.sessionId,
        message: item.message,
        configDir: projectConfigDir(project, useProjectStore.getState().claudeAccounts),
      })
    } else {
      // Sent to the Agent tab's visual agent: as its next turn if it is running,
      // else it starts (resuming the saved conversation) with the message.
      await startSessionVisualAgent(session, project, item.message)
    }
  } catch (err) {
    useToastStore.getState().addToast(
      'error',
      `Failed to inject queued message: ${err instanceof Error ? err.message : String(err)}`
    )
    return
  }

  useToastStore
    .getState()
    .addToast('info', cloud ? `Sent queued message to cloud session "${session.name}"` : `Sent queued message to "${session.name}"`)
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
