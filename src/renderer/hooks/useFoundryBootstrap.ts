import { useEffect } from 'react'
import { useProjectStore } from '../stores/projectStore'
import { useSessionStore } from '../stores/sessionStore'
import { useTerminalStore } from '../stores/terminalStore'
import { useToastStore } from '../stores/toastStore'
import { useFoundryStore } from '../stores/foundryStore'
import type { FoundryFireTaskPayload, Session } from '../../shared/types'

function sortByCreatedAtDesc(sessions: Session[]): Session[] {
  return [...sessions].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )
}

/**
 * Renderer-side worker for Foundry: receives FOUNDRY_FIRE_TASK, materializes a
 * session (worktree + Session record + claude PTY), then acks the pipeline.
 *
 * Modeled on fireQueuedSession (proven path); does NOT switch the user's
 * active session — autopilot must not yank the user's view.
 */
export async function materializeFoundryTask(payload: FoundryFireTaskPayload): Promise<void> {
  const { projects } = useProjectStore.getState()
  const project = projects.find((p) => p.id === payload.projectId)
  if (!project) {
    useToastStore
      .getState()
      .addToast('error', `Foundry task couldn't fire — project ${payload.projectId} not registered.`)
    return
  }

  let worktreeInfo: { path: string; branch: string }
  try {
    worktreeInfo = await window.api.worktree.create(
      project.repoPath,
      payload.suggestedSessionName,
      payload.baseBranch
    )
  } catch (err) {
    useToastStore
      .getState()
      .addToast(
        'error',
        `Foundry: worktree create failed (${err instanceof Error ? err.message : String(err)})`
      )
    return
  }

  const now = new Date().toISOString()
  const newSession: Session = {
    id: crypto.randomUUID(),
    name: payload.suggestedSessionName,
    branchName: worktreeInfo.branch,
    worktreePath: worktreeInfo.path,
    projectId: project.id,
    createdAt: now,
    lastActiveAt: now,
    baseBranch: payload.baseBranch,
    notionTicket: payload.page.url
      ? { pageId: payload.page.id, url: payload.page.url, title: payload.page.title }
      : undefined,
  }

  const existing = await window.api.session.list(project.id)
  const updated = sortByCreatedAtDesc([...existing, newSession])
  await window.api.session.save(project.id, updated)

  const sessionState = useSessionStore.getState()
  if (sessionState.currentProjectId === project.id) {
    useSessionStore.setState({ sessions: updated })
  }

  // Latent-bug fix: quiet-created sessions never call registerSession from the
  // App.tsx / SessionSidebar render paths, so their hook events get dropped.
  // Register explicitly here.
  try {
    await window.api.notification.registerSession(
      newSession.id,
      newSession.name,
      project.id,
      newSession.worktreePath
    )
  } catch {
    // Best-effort — notification routing degrades gracefully without this.
  }

  const account = useProjectStore
    .getState()
    .claudeAccounts.find((a) => a.id === project.claudeAccountId)

  try {
    const terminalId = await window.api.foundry.spawnWorker(
      newSession.id,
      newSession.worktreePath,
      payload.resolvedImplementPrompt,
      'dark',
      account?.configDir,
      project.repoPath,
      newSession.id,
      'agent',
      payload.workerPermissionMode
    )
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
  } catch (err) {
    useToastStore
      .getState()
      .addToast(
        'error',
        `Foundry: worker spawn failed (${err instanceof Error ? err.message : String(err)})`
      )
    return
  }

  await window.api.foundry.taskStarted(payload.foundryId, {
    pipelineId: payload.pipelineId,
    sessionId: newSession.id,
    branch: worktreeInfo.branch,
    worktreePath: worktreeInfo.path,
    baseBranch: payload.baseBranch,
  })

  useToastStore.getState().addToast('success', `Foundry started: "${newSession.name}"`)
}

export function useFoundryBootstrap(): void {
  const setConfigs = useFoundryStore((s) => s.setConfigs)
  const upsertState = useFoundryStore((s) => s.upsertState)

  useEffect(() => {
    void (async () => {
      try {
        const configs = await window.api.foundry.list()
        setConfigs(configs)
        for (const c of configs) {
          const state = await window.api.foundry.getState(c.id)
          if (state) upsertState(c.id, state)
        }
      } catch {
        // No-op on load failure — store stays empty.
      }
    })()
  }, [setConfigs, upsertState])

  useEffect(() => {
    const offFire = window.api.foundry.onFireTask((payload) => {
      void materializeFoundryTask(payload)
    })
    const offState = window.api.foundry.onStateUpdate((foundryId, state) => {
      upsertState(foundryId, state)
    })
    return () => {
      offFire()
      offState()
    }
  }, [upsertState])
}
