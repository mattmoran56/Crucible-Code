// The renderer half of session dispatch: answers the `crucible` MCP server's
// tool calls (forwarded by the main process) by creating and driving sessions
// through the same paths as the UI, the scheduler and the Notion pickup.
//
// A dispatched session is created quietly: it shows up in its project's
// sidebar and its agent starts working, but the user's view is not switched to
// it. By default it is a normal worktree session (own worktree, own branch, so
// own PR) and is cleaned up after its PR merges like any other.

import { useEffect } from 'react'
import type { Project, Session } from '../../shared/types'
import type {
  DispatchedBy,
  DispatchSessionArgs,
  SendToSessionArgs,
  SessionDispatchRequest,
  SessionDispatchResponse,
} from '../../shared/session-dispatch'
import { toSessionName, uniqueSessionName } from '../../shared/session-name'
import { useProjectStore } from '../stores/projectStore'
import { useSessionStore } from '../stores/sessionStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useCloudSessionStore } from '../stores/cloudSessionStore'
import { useToastStore } from '../stores/toastStore'
import { startSessionVisualAgent } from './startVisualAgent'
import { projectConfigDir } from './visualAgents'

const CODE_EDITOR_PREFIX = 'code-editor:'

/** Where a tool call came from: the project, and the session when it was one. */
export interface DispatchOrigin {
  project: Project
  session: Session | null
}

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err))

const sortByCreatedAtDesc = (sessions: Session[]): Session[] =>
  [...sessions].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

/** A project's sessions: the live list when it is the one shown, else from disk. */
async function projectSessions(projectId: string): Promise<Session[]> {
  const state = useSessionStore.getState()
  if (state.currentProjectId === projectId) return state.sessions
  return window.api.session.list(projectId)
}

/** Persist a project's sessions, and show them when it is the project on screen. */
async function saveProjectSessions(projectId: string, sessions: Session[]): Promise<void> {
  await window.api.session.save(projectId, sessions)
  if (useSessionStore.getState().currentProjectId === projectId) useSessionStore.setState({ sessions })
}

/** Resolve the agent's context id (a session id, or `code-editor:<projectId>`) to its project and session. */
export async function resolveDispatchOrigin(contextId: string): Promise<DispatchOrigin> {
  const { projects } = useProjectStore.getState()
  if (contextId.startsWith(CODE_EDITOR_PREFIX)) {
    const project = projects.find((p) => p.id === contextId.slice(CODE_EDITOR_PREFIX.length))
    if (project) return { project, session: null }
  }
  const live = useSessionStore.getState().sessions.find((s) => s.id === contextId)
  if (live) {
    const project = projects.find((p) => p.id === live.projectId)
    if (project) return { project, session: live }
  }
  for (const project of projects) {
    const match = (await window.api.session.list(project.id)).find((s) => s.id === contextId)
    if (match) return { project, session: match }
  }
  throw new Error('Crucible could not tell which session this call came from, so it does not know which project to use.')
}

function originLabel(origin: DispatchOrigin): DispatchedBy {
  return origin.session ? { sessionId: origin.session.id, name: origin.session.name } : { name: 'Code workspace' }
}

/** The new session's name: the one asked for, else from the task, made unique in the project. */
export function dispatchedSessionName(args: Pick<DispatchSessionArgs, 'name' | 'task'>, taken: string[]): string {
  const base =
    (args.name ? toSessionName(args.name) : null) ?? toSessionName(args.task) ?? 'Dispatched session'
  return uniqueSessionName(base, taken)
}

/** Create the session described by `args` and start its agent on the task. */
export async function dispatchSession(origin: DispatchOrigin, args: DispatchSessionArgs): Promise<string> {
  const { project } = origin
  const name = dispatchedSessionName(args, (await projectSessions(project.id)).map((s) => s.name))
  const now = new Date().toISOString()
  const dispatchedBy = originLabel(origin)
  const cloud = args.location === 'cloud'

  let session: Session
  if (!args.worktree) {
    session = {
      id: crypto.randomUUID(),
      name,
      branchName: '',
      worktreePath: project.repoPath,
      projectId: project.id,
      createdAt: now,
      lastActiveAt: now,
      repoRoot: true,
      dispatchedBy,
    }
  } else {
    const info = await window.api.worktree.create(project.repoPath, name, args.baseBranch, args.branchName)
    session = {
      id: crypto.randomUUID(),
      name,
      branchName: info.branch,
      worktreePath: info.path,
      projectId: project.id,
      createdAt: now,
      lastActiveAt: now,
      ownsBranch: true,
      dispatchedBy,
      ...(args.baseBranch ? { baseBranch: args.baseBranch } : {}),
    }
    if (cloud) {
      session.location = 'cloud'
      session.cloudPending = {
        task: args.task,
        branch: info.branch,
        ...(args.mode === 'orchestrator' ? { mode: 'orchestrator' as const } : {}),
        createdAt: now,
      }
    } else if (args.mode === 'orchestrator') {
      session.mode = 'orchestrator'
    }
  }

  // Re-read: the list may have changed while the worktree was being made.
  await saveProjectSessions(project.id, sortByCreatedAtDesc([...(await projectSessions(project.id)), session]))

  // Quiet-created sessions skip the render paths that register hook routing.
  try {
    await window.api.notification.registerSession(session.id, session.name, project.id, session.worktreePath)
  } catch {
    // Best effort
  }

  const where = session.repoRoot
    ? `in the project's main checkout (${project.repoPath}), no worktree or branch of its own`
    : `on branch ${session.branchName} in its own worktree (${session.worktreePath})`
  const lines = [`Started session "${session.name}" (id ${session.id}) ${where}.`]

  if (cloud) {
    // Same create the session's Agent tab would run, started now so it does
    // not wait for the user to open the session. App-level listeners save the
    // cloud link and send the kickoff once the CLI prints it.
    const state = await window.api.cloudSession.start({
      sessionId: session.id,
      projectId: project.id,
      worktreePath: session.worktreePath,
      branch: session.branchName,
      task: args.task,
      mode: args.mode,
      configDir: projectConfigDir(project, useProjectStore.getState().claudeAccounts),
      repoPath: project.repoPath,
      claudeTheme: useSettingsStore.getState().claudeTheme,
    })
    useCloudSessionStore.getState().setCreate(state)
    if (state.status === 'failed') {
      lines.push(`Creating it in Claude Code on the web failed: ${state.error ?? 'unknown error'}. The user can retry from the session's Agent tab.`)
    } else {
      lines.push(
        'It is being created in Claude Code on the web. If the Claude CLI asks anything while creating it, the user answers in that session\'s Agent tab in Crucible.'
      )
    }
  } else {
    await startSessionVisualAgent(session, project, args.task)
    lines.push('Its agent is running locally on the task.')
  }

  lines.push('The user can open it from the Crucible sidebar. Use send_to_session with its id to message it.')
  useToastStore.getState().addToast('info', `${dispatchedBy.name} started session "${session.name}"`)
  return lines.join('\n')
}

/** Describe the origin project's sessions for the agent. */
export async function listSessions(origin: DispatchOrigin): Promise<string> {
  const sessions = await projectSessions(origin.project.id)
  const rows = sessions.map((s) => ({
    id: s.id,
    name: s.name,
    branch: s.repoRoot ? null : s.branchName,
    runs: s.location === 'cloud' ? 'cloud' : 'local',
    worktree: !s.repoRoot,
    ...(s.mode === 'orchestrator' || s.cloudPending?.mode === 'orchestrator' ? { mode: 'orchestrator' } : {}),
    ...(s.dispatchedBy ? { dispatchedBy: s.dispatchedBy.name } : {}),
    ...(s.id === origin.session?.id ? { thisSession: true } : {}),
    createdAt: s.createdAt,
  }))
  return JSON.stringify({ project: origin.project.name, sessions: rows }, null, 2)
}

/** Send `message` to another session in the origin's project as its next turn. */
export async function sendToSession(origin: DispatchOrigin, args: SendToSessionArgs): Promise<string> {
  if (args.sessionId === origin.session?.id) throw new Error('That is this session: send_to_session is for other sessions.')
  const target = (await projectSessions(origin.project.id)).find((s) => s.id === args.sessionId)
  if (!target) throw new Error(`No session with id ${args.sessionId} in project "${origin.project.name}". Use list_sessions to see them.`)

  if (target.location === 'cloud') {
    if (!target.cloud) throw new Error(`The cloud session "${target.name}" has not finished being created yet.`)
    await window.api.cloudSession.send({
      worktreePath: target.worktreePath,
      cloudSessionId: target.cloud.sessionId,
      message: args.message,
      configDir: projectConfigDir(origin.project, useProjectStore.getState().claudeAccounts),
    })
    return `Sent to cloud session "${target.name}".`
  }
  await startSessionVisualAgent(target, origin.project, args.message)
  return `Sent to "${target.name}".`
}

/** Answer one forwarded tool call. Never throws: errors go back to the agent. */
export async function handleSessionDispatchRequest(req: SessionDispatchRequest): Promise<SessionDispatchResponse> {
  try {
    const origin = await resolveDispatchOrigin(req.contextId)
    switch (req.tool) {
      case 'dispatch_session':
        return { ok: true, text: await dispatchSession(origin, req.args) }
      case 'list_sessions':
        return { ok: true, text: await listSessions(origin) }
      case 'send_to_session':
        return { ok: true, text: await sendToSession(origin, req.args) }
      default:
        return { ok: false, error: 'Unknown tool' }
    }
  } catch (err) {
    return { ok: false, error: errorMessage(err) }
  }
}

/** Mount once at the top of the tree (beside the scheduler and Notion bootstraps). */
export function useSessionDispatchBootstrap(): void {
  useEffect(() => {
    const off = window.api.sessionDispatch?.onRequest?.((req) => {
      void handleSessionDispatchRequest(req).then((response) => window.api.sessionDispatch.respond(req.id, response))
    })
    return () => {
      off?.()
    }
  }, [])
}
