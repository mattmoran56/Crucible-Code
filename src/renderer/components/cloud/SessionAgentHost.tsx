// The core Agent tab of a session. Picks what it shows:
// - a cloud session (or one teleported during this run) → CloudAgentHost
// - a session teleported in an earlier run whose local Claude session has not
//   been looked up yet → find it, then resume it as a visual agent
// - anything else → the normal visual agent

import React, { useEffect, useRef } from 'react'
import type { Session } from '../../../shared/types'
import { DEFAULT_VISUAL_AGENT_MODEL } from '../../../shared/visual-agent'
import { projectConfigDir } from '../../lib/visualAgents'
import { useCloudSessionStore } from '../../stores/cloudSessionStore'
import { useProjectStore } from '../../stores/projectStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useToastStore } from '../../stores/toastStore'
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
 * Finds the local Claude session a teleport wrote and records it as the Agent
 * tab's visual agent, so it resumes the teleported conversation. On failure it
 * records that it tried and falls through to a fresh visual agent.
 */
function TeleportResume({ session, visible }: { session: Session; visible: boolean }) {
  const project = useProjectStore((s) => s.projects.find((p) => p.id === session.projectId))
  const accounts = useProjectStore((s) => s.claudeAccounts)
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current || !session.cloud?.teleportedAt) return
    ran.current = true
    const cloud = session.cloud
    void (async () => {
      let claudeSessionId: string | null = null
      try {
        claudeSessionId = await window.api.cloudSession.discoverLocal({
          worktreePath: session.worktreePath,
          configDir: projectConfigDir(project, accounts),
          since: cloud.teleportedAt!,
        })
      } catch {
        claudeSessionId = null
      }
      if (!claudeSessionId) {
        useToastStore
          .getState()
          .addToast('info', `Couldn't find the teleported conversation for ${session.name} — starting a fresh agent.`)
      }
      // One write, so the switch to the visual agent sees both at once.
      await useSessionStore.getState().patchSession(session.projectId, session.id, {
        cloud: { ...cloud, localResumeResolved: true },
        ...(claudeSessionId
          ? {
              visualAgents: {
                ...session.visualAgents,
                agent: { claudeSessionId, model: DEFAULT_VISUAL_AGENT_MODEL },
              },
            }
          : {}),
      })
    })()
  }, [session, project, accounts])

  if (!visible) return null
  return (
    <p className="m-auto! flex items-center gap-2 text-[12.5px] text-text-muted">
      <Spinner className="text-accent" /> Opening the teleported session…
    </p>
  )
}
