// Start a session's visual agent without its panel being mounted — for flows
// that create or drive a session in the background (Notion pickup, scheduled
// sessions, queued messages). When the user later opens the session, the
// Agent tab's panel attaches to the already-running agent.

import type { Project, Session } from '../../shared/types'
import { useProjectStore } from '../stores/projectStore'
import { useSessionStore } from '../stores/sessionStore'
import { useVisualAgentStore } from '../stores/visualAgentStore'
import { buildVisualAgentStartOptions, type VisualAgentTabKey } from './visualAgents'

/**
 * Start (or resume) the session's core Agent tab with `prompt` as its next
 * turn — its first message when this starts it, or sent to it when it is
 * already running — and remember the Claude session it lands on so a restart
 * resumes it.
 */
export async function startSessionVisualAgent(
  session: Session,
  project: Project | null | undefined,
  prompt: string | null,
  tabKey: VisualAgentTabKey = 'agent',
): Promise<void> {
  const accounts = useProjectStore.getState().claudeAccounts
  const opts = buildVisualAgentStartOptions({ session, project, accounts, tabKey, initialPrompt: prompt })
  await useVisualAgentStore.getState().startWithPrompt(opts)
  const snap = useVisualAgentStore.getState().agents[opts.agentId]
  if (snap?.claudeSessionId) {
    void useSessionStore
      .getState()
      .setSessionVisualAgent(session.projectId, session.id, tabKey, { claudeSessionId: snap.claudeSessionId, model: snap.model })
  }
}
