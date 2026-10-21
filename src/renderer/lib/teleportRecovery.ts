// A teleport that never got the conversation onto disk.
//
// Clicking Teleport marks the session local (`teleportedAt`) straight away, so
// transcript discovery knows where to look if the run is interrupted. But
// interactive `claude --teleport` only writes a local transcript after the
// user's first message, so a teleport abandoned before that (app quit, CLI
// killed, timeout, "Cancel teleport") leaves nothing local. Such
// a session is not local at all: it goes back to the cloud page with a notice
// and a way to teleport again, rather than starting a fresh agent and losing
// the cloud conversation.

import type { Session } from '../../shared/types'

/**
 * Marked as teleported but not confirmed: no local Claude session recorded
 * for the Agent tab. Whether a transcript exists on disk still has to be
 * checked (discoverLocal).
 */
export const isUnconfirmedTeleport = (session: Session): boolean =>
  session.location !== 'cloud' && !!session.cloud?.teleportedAt && !session.visualAgents?.agent?.claudeSessionId

/** The patch that puts an abandoned teleport back in the cloud, flagged incomplete. */
export function abandonedTeleportPatch(session: Session): Partial<Session> {
  if (!session.cloud) return {}
  const { teleportedAt: _at, localResumeResolved: _resolved, ...link } = session.cloud
  return { location: 'cloud', cloud: { ...link, teleportIncomplete: true } }
}

/**
 * Load-time migration: every unconfirmed teleport with no local transcript
 * and no live run goes back to the cloud. Sessions with a transcript are left
 * alone (the Agent tab resumes them). Returns the list unchanged (same array)
 * when nothing moved.
 */
export async function recoverAbandonedTeleports(
  sessions: Session[],
  opts: { configDir: string | null; liveTeleports: Record<string, string> }
): Promise<Session[]> {
  const candidates = sessions.filter((s) => isUnconfirmedTeleport(s) && !(s.id in opts.liveTeleports))
  if (candidates.length === 0) return sessions
  const api = window.api.cloudSession
  const abandoned = new Set<string>()
  await Promise.all(
    candidates.map(async (s) => {
      try {
        // A run still going in the main process (e.g. the renderer reloaded).
        const run = await api.teleportState?.(s.id)
        if (run && run.status !== 'done' && run.status !== 'failed') return
        const found = await api.discoverLocal({
          worktreePath: s.worktreePath,
          configDir: opts.configDir,
          since: s.cloud!.teleportedAt!,
        })
        if (!found) abandoned.add(s.id)
      } catch {
        // Unknown: leave it for the Agent tab to resolve.
      }
    })
  )
  if (abandoned.size === 0) return sessions
  return sessions.map((s) => (abandoned.has(s.id) ? { ...s, ...abandonedTeleportPatch(s) } : s))
}
