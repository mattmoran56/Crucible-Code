// After a teleport: hand the (now local) session to the visual agent.
//
// One path for both cases — a teleport finishing during this run (the main
// process reports the local Claude session id) and one from an earlier run
// whose id is looked up from the transcripts on disk. Either way the session
// follows the branch the teleport really checked out, records that the lookup
// happened, and gets `visualAgents.agent` pointed at the teleported
// conversation, which the Agent tab then resumes (`--resume <id>`) with its
// history rebuilt from Claude's transcript.

import { useEffect } from 'react'
import type { CloudTeleportState, Session } from '../../shared/types'
import { DEFAULT_VISUAL_AGENT_MODEL } from '../../shared/visual-agent'
import { useCloudSessionStore } from '../stores/cloudSessionStore'
import { useSessionStore } from '../stores/sessionStore'
import { useToastStore } from '../stores/toastStore'
import { destroyTerminal } from '../components/terminal/useTerminal'
import { branchMismatchToast, reconcileTeleportBranch } from './teleportBranch'

/** The patch that resumes a teleported session's conversation in the Agent tab. */
export function teleportResumePatch(session: Session, claudeSessionId: string | null): Partial<Session> {
  const cloud = session.cloud
  return {
    ...(cloud ? { cloud: { ...cloud, localResumeResolved: true } } : {}),
    ...(claudeSessionId
      ? {
          visualAgents: {
            ...session.visualAgents,
            agent: { claudeSessionId, model: session.visualAgents?.agent?.model ?? DEFAULT_VISUAL_AGENT_MODEL },
          },
        }
      : {}),
  }
}

/**
 * Point a teleported session at its local Claude conversation (or, when none
 * was found, let it start a fresh agent) and leave the teleport view.
 */
export async function resumeTeleportedSession(session: Session, claudeSessionId: string | null): Promise<void> {
  const store = useSessionStore.getState()
  const current = store.currentProjectId === session.projectId
  let branchName: string | undefined
  if (current) {
    // Follow the branch the teleport actually checked out (toast once).
    const mismatch = await reconcileTeleportBranch(session)
    if (mismatch) {
      branchName = mismatch.actual
      if (!useCloudSessionStore.getState().branchNotices[session.id]) {
        useToastStore.getState().addToast('info', branchMismatchToast(session.name, mismatch))
      }
    }
  }
  if (!claudeSessionId) {
    useToastStore
      .getState()
      .addToast('info', `Couldn't find the teleported conversation for ${session.name} — starting a fresh agent.`)
  }
  // Re-read: the branch reconcile may have patched the session.
  const latest = useSessionStore.getState().sessions.find((s) => s.id === session.id) ?? session
  const patch = { ...teleportResumePatch(latest, claudeSessionId), ...(branchName ? { branchName } : {}) }
  if (current) {
    // One write, so the switch to the visual agent sees it all at once.
    await store.patchSession(session.projectId, session.id, patch)
  } else {
    const list = await window.api.session.list(session.projectId)
    await window.api.session.save(
      session.projectId,
      list.map((s) => (s.id === session.id ? { ...s, ...teleportResumePatch(s, claudeSessionId) } : s))
    )
  }
  useCloudSessionStore.getState().clearTeleport(session.id)
}

/** Find a session by id in the open project, else in its saved list. */
async function findSession(sessionId: string, projectId?: string): Promise<Session | null> {
  const open = useSessionStore.getState().sessions.find((s) => s.id === sessionId)
  if (open) return open
  if (!projectId) return null
  const list = await window.api.session.list(projectId)
  return list.find((s) => s.id === sessionId) ?? null
}

/** A finished teleport run → resume it in the Agent tab (once per run). */
const applied = new Set<string>()
export async function applyTeleportState(state: CloudTeleportState): Promise<void> {
  if (state.status !== 'done' || !state.claudeSessionId) return
  const key = `${state.sessionId}|${state.terminalId}`
  if (applied.has(key)) return
  applied.add(key)
  const session = await findSession(state.sessionId, state.projectId)
  if (!session) return
  await resumeTeleportedSession(session, state.claudeSessionId)
  // The teleport PTY has exited; drop its xterm instance.
  destroyTerminal(state.terminalId)
}

/** Test hook. */
export function _resetAppliedTeleports(): void {
  applied.clear()
}

/** App-level: track teleport runs and switch each to the visual agent when it is done. */
export function useCloudTeleportBootstrap(): void {
  useEffect(() => {
    const off = window.api.cloudSession?.onTeleportEvent?.((state) => {
      useCloudSessionStore.getState().setTeleportRun(state)
      void applyTeleportState(state)
    })
    return () => off?.()
  }, [])
}
