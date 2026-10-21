// Glue between workspace tabs / sessions and the Visual Agent feature.
//
// Every agent tab in a session workspace is a visual agent: the core Agent tab
// and every dynamic `agent:N` tab (plus `visual-agent:N` tabs saved before
// agents were always visual).

import type { ClaudeAccount, Project, Session } from '../../shared/types'
import { DEFAULT_VISUAL_AGENT_MODEL, type VisualAgentStartOptions } from '../../shared/visual-agent'

/** Key a visual agent is persisted under on the Session: 'agent' for the core tab, else the dynamic tab id. */
export type VisualAgentTabKey = 'agent' | `agent:${string}` | `visual-agent:${string}`

export const visualAgentId = (sessionId: string, tabKey: VisualAgentTabKey): string => `${sessionId}:${tabKey}`

/** Same resolution as terminalStore's getActiveProjectConfigDir, for a given project. */
export const projectConfigDir = (project: Project | null | undefined, accounts: ClaudeAccount[]): string | null => {
  if (!project?.claudeAccountId) return null
  return accounts.find((a) => a.id === project.claudeAccountId)?.configDir ?? null
}

export function buildVisualAgentStartOptions(args: {
  session: Session
  project: Project | null | undefined
  accounts: ClaudeAccount[]
  tabKey: VisualAgentTabKey
  initialPrompt?: string | null
}): VisualAgentStartOptions {
  const { session, project, accounts, tabKey, initialPrompt } = args
  const saved = session.visualAgents?.[tabKey]
  return {
    agentId: visualAgentId(session.id, tabKey),
    sessionId: session.id,
    cwd: session.worktreePath,
    repoPath: project?.repoPath,
    model: saved?.model ?? DEFAULT_VISUAL_AGENT_MODEL,
    resumeClaudeSessionId: saved?.claudeSessionId ?? null,
    claudeConfigDir: projectConfigDir(project, accounts),
    initialPrompt: initialPrompt?.trim() ? initialPrompt.trim() : null,
  }
}
