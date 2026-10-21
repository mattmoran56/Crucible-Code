// Mounts a VisualAgentPanel for one session + workspace tab, and keeps the
// session's persisted resume record (Claude session id + model) in step with
// what the running agent reports — so the next app launch picks the same
// conversation back up.

import React, { useEffect, useMemo } from 'react'
import { useProjectStore } from '../../stores/projectStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useVisualAgentStore } from '../../stores/visualAgentStore'
import { buildVisualAgentStartOptions, visualAgentId, type VisualAgentTabKey } from '../../lib/visualAgents'
import { VisualAgentPanel } from './VisualAgentPanel'

/**
 * Startup prompts consumed per agent. Consuming is one-shot, so it is cached
 * here rather than in render state, where StrictMode's double render would
 * consume it on the first pass and lose it on the second.
 */
const consumedPrompts = new Map<string, string | null>()

export function VisualAgentHost({
  sessionId,
  tabKey,
  visible,
}: {
  sessionId: string
  tabKey: VisualAgentTabKey
  visible: boolean
}) {
  const session = useSessionStore((s) => s.sessions.find((x) => x.id === sessionId))
  const project = useProjectStore((s) => s.projects.find((p) => p.id === session?.projectId))
  const accounts = useProjectStore((s) => s.claudeAccounts)
  const agentId = visualAgentId(sessionId, tabKey)

  // Read once per agent: the panel only honours its first start options anyway.
  const startOptions = useMemo(() => {
    if (!session) return null
    if (!consumedPrompts.has(agentId)) {
      const prompt = tabKey === 'agent' ? useSessionStore.getState().consumePendingStartup(sessionId) : null
      consumedPrompts.set(agentId, prompt)
    }
    return buildVisualAgentStartOptions({
      session,
      project,
      accounts,
      tabKey,
      initialPrompt: consumedPrompts.get(agentId) ?? null,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, !!session])

  const claudeSessionId = useVisualAgentStore((s) => s.agents[agentId]?.claudeSessionId ?? null)
  const model = useVisualAgentStore((s) => s.agents[agentId]?.model ?? null)
  const projectId = session?.projectId

  useEffect(() => {
    if (!projectId || !claudeSessionId || !model) return
    // Once the agent has really started, the prompt is spent.
    consumedPrompts.set(agentId, null)
    void useSessionStore.getState().setSessionVisualAgent(projectId, sessionId, tabKey, { claudeSessionId, model })
  }, [projectId, sessionId, tabKey, agentId, claudeSessionId, model])

  if (!session || !startOptions) return null
  return <VisualAgentPanel agentId={agentId} startOptions={startOptions} visible={visible} />
}
