// Turning a finished interactive `claude --cloud` run into a saved cloud
// session: pending (`cloudPending`, no id) → ready (`cloud: {sessionId, url}`).

import { useEffect } from 'react'
import type { CloudCreateState, Session } from '../../shared/types'
import { useCloudSessionStore } from '../stores/cloudSessionStore'
import { useSessionStore } from '../stores/sessionStore'
import { useCloudTeleportBootstrap } from './cloudTeleport'

/** The patch that makes a pending session a ready cloud session, or null when there is nothing to do. */
export function cloudCreatedPatch(session: Session, state: CloudCreateState): Partial<Session> | null {
  if (state.status !== 'created' || !state.result) return null
  if (session.cloud?.sessionId === state.result.sessionId) return null
  // Already bound to another cloud session (or teleported): never overwrite.
  if (session.cloud) return null
  return {
    location: 'cloud',
    cloud: {
      sessionId: state.result.sessionId,
      url: state.result.url,
      branch: state.result.branch ?? session.cloudPending?.branch ?? session.branchName,
    },
    cloudPending: undefined,
  }
}

/** Persist a created cloud session, whether or not its project is the one open. */
export async function applyCloudCreated(state: CloudCreateState): Promise<void> {
  if (state.status !== 'created') return
  const store = useSessionStore.getState()
  if (store.currentProjectId === state.projectId) {
    const session = store.sessions.find((s) => s.id === state.sessionId)
    const patch = session ? cloudCreatedPatch(session, state) : null
    if (patch) await store.patchSession(state.projectId, state.sessionId, patch)
    return
  }
  const list = await window.api.session.list(state.projectId)
  const session = list.find((s) => s.id === state.sessionId)
  const patch = session ? cloudCreatedPatch(session, state) : null
  if (!patch) return
  await window.api.session.save(
    state.projectId,
    list.map((s) => (s.id === state.sessionId ? { ...s, ...patch } : s))
  )
}

/**
 * App-level: track create runs and save each new cloud session as soon as the
 * CLI prints it; track teleport runs too (lib/cloudTeleport).
 */
export function useCloudCreateBootstrap(): void {
  useCloudTeleportBootstrap()
  useEffect(() => {
    const off = window.api.cloudSession?.onCreateEvent?.((state) => {
      useCloudSessionStore.getState().setCreate(state)
      void applyCloudCreated(state)
    })
    return () => off?.()
  }, [])
}
