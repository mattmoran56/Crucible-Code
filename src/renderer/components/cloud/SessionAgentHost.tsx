// The core Agent tab of a session. Picks what it shows:
// - a cloud session (or one being teleported right now) → CloudAgentHost,
//   which shows the "Teleporting…" view until the conversation is local
// - a teleported session whose local Claude session has not been looked up
//   yet (teleported in an earlier run) → find it, then resume it visually
// - anything else → the normal visual agent

import React, { useEffect, useRef } from 'react'
import type { Session } from '../../../shared/types'
import { projectConfigDir } from '../../lib/visualAgents'
import { resumeTeleportedSession } from '../../lib/cloudTeleport'
import { useCloudSessionStore } from '../../stores/cloudSessionStore'
import { useProjectStore } from '../../stores/projectStore'
import { useSessionStore } from '../../stores/sessionStore'
import { VisualAgentHost } from '../visual-agent/VisualAgentHost'
import { Spinner } from '../visual-agent/icons'
import { CloudAgentHost } from './CloudAgentHost'

/** A teleported session whose local Claude session id still has to be found. */
export const needsTeleportResume = (session: Session): boolean =>
  session.location !== 'cloud' &&
  !!session.cloud?.teleportedAt &&
  !session.cloud.localResumeResolved &&
  !session.visualAgents?.agent

export function SessionAgentHost({ sessionId, visible }: { sessionId: string; visible: boolean }) {
  const session = useSessionStore((s) => s.sessions.find((x) => x.id === sessionId))
  const teleportedThisRun = useCloudSessionStore((s) => sessionId in s.teleports)
  if (!session) return null
  if (session.location === 'cloud' || teleportedThisRun) return <CloudAgentHost sessionId={sessionId} visible={visible} />
  if (needsTeleportResume(session)) return <TeleportResume session={session} visible={visible} />
  return <VisualAgentHost sessionId={sessionId} tabKey="agent" visible={visible} />
}

/**
 * Finds the local Claude session a teleport wrote (in an earlier run, or one
 * whose PTY went away before it reported) and hands it to the visual agent —
 * the same path a teleport finishing in this run takes (lib/cloudTeleport).
 * With nothing found the teleport was abandoned: the session goes back to
 * the cloud (lib/teleportRecovery).
 */
function TeleportResume({ session, visible }: { session: Session; visible: boolean }) {
  const project = useProjectStore((s) => s.projects.find((p) => p.id === session.projectId))
  const accounts = useProjectStore((s) => s.claudeAccounts)
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current || !session.cloud?.teleportedAt) return
    ran.current = true
    const since = session.cloud.teleportedAt
    void (async () => {
      let claudeSessionId: string | null = null
      try {
        claudeSessionId = await window.api.cloudSession.discoverLocal({
          worktreePath: session.worktreePath,
          configDir: projectConfigDir(project, accounts),
          since,
        })
      } catch {
        claudeSessionId = null
      }
      await resumeTeleportedSession(session, claudeSessionId)
    })()
  }, [session, project, accounts])

  if (!visible) return null
  return (
    <p className="m-auto! flex items-center gap-2 text-[12.5px] text-text-muted">
      <Spinner className="text-accent" /> Opening the teleported session…
    </p>
  )
}
