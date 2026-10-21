import { describe, expect, it } from 'vitest'
import {
  buildVisualAgentStartOptions,
  projectConfigDir,
  visualAgentId,
} from '../../../src/renderer/lib/visualAgents'
import { DEFAULT_VISUAL_AGENT_MODEL } from '../../../src/shared/visual-agent'
import type { ClaudeAccount, Project, Session } from '../../../src/shared/types'

const project: Project = { id: 'p1', name: 'acme', repoPath: '/repo', claudeAccountId: 'a2' }
const accounts: ClaudeAccount[] = [
  { id: 'a1', label: 'Personal', configDir: '/cfg/one' },
  { id: 'a2', label: 'Work', configDir: '/cfg/two' },
] as ClaudeAccount[]
const session: Session = {
  id: 's1',
  name: 'feat',
  branchName: 'session/feat',
  worktreePath: '/wt/feat',
  projectId: 'p1',
  createdAt: '2026-10-21T00:00:00Z',
}

describe('buildVisualAgentStartOptions', () => {
  it('starts a fresh agent on the default model in the session worktree', () => {
    const opts = buildVisualAgentStartOptions({ session, project, accounts, tabKey: 'agent', initialPrompt: '  fix it  ' })
    expect(opts).toEqual({
      agentId: 's1:agent',
      sessionId: 's1',
      cwd: '/wt/feat',
      repoPath: '/repo',
      model: DEFAULT_VISUAL_AGENT_MODEL,
      resumeClaudeSessionId: null,
      claudeConfigDir: '/cfg/two',
      initialPrompt: 'fix it',
    })
  })

  it('resumes the persisted conversation and model for the tab', () => {
    const withSaved: Session = {
      ...session,
      visualAgents: { 'visual-agent:3': { claudeSessionId: 'cs-9', model: 'claude-sonnet-5-5' } },
    }
    const opts = buildVisualAgentStartOptions({ session: withSaved, project, accounts, tabKey: 'visual-agent:3' })
    expect(opts.agentId).toBe(visualAgentId('s1', 'visual-agent:3'))
    expect(opts.resumeClaudeSessionId).toBe('cs-9')
    expect(opts.model).toBe('claude-sonnet-5-5')
    expect(opts.initialPrompt).toBeNull()
  })

  it('resumes a dynamic agent:N tab under its own key', () => {
    const withSaved: Session = {
      ...session,
      visualAgents: { 'agent:2': { claudeSessionId: 'cs-2', model: 'claude-opus-5-5' } },
    }
    const opts = buildVisualAgentStartOptions({ session: withSaved, project, accounts, tabKey: 'agent:2' })
    expect(opts.agentId).toBe('s1:agent:2')
    expect(opts.resumeClaudeSessionId).toBe('cs-2')
  })

  it('resolves the config dir like the terminal store', () => {
    expect(projectConfigDir({ ...project, claudeAccountId: undefined }, accounts)).toBeNull()
    expect(projectConfigDir({ ...project, claudeAccountId: 'missing' }, accounts)).toBeNull()
    expect(projectConfigDir(project, accounts)).toBe('/cfg/two')
  })
})
