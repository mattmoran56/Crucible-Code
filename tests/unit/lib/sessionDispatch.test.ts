/**
 * The renderer half of session dispatch: an agent's `crucible` MCP tool call,
 * forwarded by the main process, creating / listing / messaging sessions.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  dispatchedSessionName,
  handleSessionDispatchRequest,
} from '../../../src/renderer/lib/sessionDispatch'
import { useProjectStore } from '../../../src/renderer/stores/projectStore'
import { useSessionStore } from '../../../src/renderer/stores/sessionStore'
import { useToastStore } from '../../../src/renderer/stores/toastStore'
import { useCloudSessionStore } from '../../../src/renderer/stores/cloudSessionStore'
import { useVisualAgentStore, __resetVisualAgentSubscription } from '../../../src/renderer/stores/visualAgentStore'
import type { Session } from '../../../src/shared/types'
import type { DispatchSessionArgs, SessionDispatchRequest } from '../../../src/shared/session-dispatch'

const projectA = { id: 'proj-A', name: 'A', repoPath: '/repo/A' }
const projectB = { id: 'proj-B', name: 'B', repoPath: '/repo/B' }

const session = (overrides: Partial<Session> = {}): Session => ({
  id: 'sess-1',
  name: 'Planning chat',
  branchName: '',
  worktreePath: '/repo/A',
  projectId: 'proj-A',
  createdAt: '2026-05-05T10:00:00Z',
  repoRoot: true,
  ...overrides,
})

const persisted: Record<string, Session[]> = {}

const api = {
  session: {
    list: vi.fn(async (projectId: string) => (persisted[projectId] ? [...persisted[projectId]] : [])),
    save: vi.fn(async (projectId: string, sessions: Session[]) => {
      persisted[projectId] = [...sessions]
    }),
  },
  worktree: {
    create: vi.fn(async (_repo: string, name: string, _base?: string, branch?: string) => ({
      path: `/wt/${name.replace(/ /g, '-').toLowerCase()}`,
      branch: branch ?? `session/${name.replace(/ /g, '-').toLowerCase()}`,
    })),
  },
  notification: { registerSession: vi.fn(async () => {}) },
  visualAgent: {
    start: vi.fn(async (opts: { agentId: string; model: string }) => ({
      agentId: opts.agentId,
      claudeSessionId: `cs-${opts.agentId}`,
      model: opts.model,
      state: 'idle',
      events: [],
      partial: null,
      usage: null,
      forks: [],
      turnStartedAt: null,
    })),
    getState: vi.fn(async () => null),
    send: vi.fn(async () => {}),
    onFrame: vi.fn(() => () => {}),
  },
  github: {
    listPRs: vi.fn(async () => [
      { number: 42, title: 'Fix login', headRefName: 'fix-login', state: 'OPEN' },
    ]),
  },
  cloudSession: {
    start: vi.fn(async (opts: { sessionId: string; projectId: string }) => ({
      sessionId: opts.sessionId,
      projectId: opts.projectId,
      terminalId: 'term-9',
      status: 'running',
      attached: true,
    })),
    send: vi.fn(async () => ({ sessionId: 'cloud-1', url: 'https://claude.ai/code/cloud-1' })),
  },
}

const dispatch = (args: Partial<DispatchSessionArgs>, contextId = 'sess-1'): SessionDispatchRequest => ({
  id: 'req-1',
  contextId,
  tool: 'dispatch_session',
  args: { task: 'Fix the login redirect', location: 'local', worktree: true, mode: 'single-branch', ...args },
})

beforeEach(() => {
  for (const k of Object.keys(persisted)) delete persisted[k]
  for (const group of Object.values(api)) for (const fn of Object.values(group)) (fn as any).mockClear()
  __resetVisualAgentSubscription()
  useVisualAgentStore.setState({ agents: {}, errors: {}, ui: {}, options: {} })
  useCloudSessionStore.setState({ creates: {} } as any)
  ;(window as any).api = api
  useProjectStore.setState({ projects: [projectA, projectB], activeProjectId: 'proj-A', claudeAccounts: [] } as any)
  useSessionStore.setState({ sessions: [], currentProjectId: null, activeSessionId: null } as any)
  useToastStore.setState({ toasts: [] })
})

describe('dispatchedSessionName', () => {
  it('uses the given name, else the task, made unique', () => {
    expect(dispatchedSessionName({ name: 'Fix login', task: 'x' }, [])).toBe('Fix login')
    expect(dispatchedSessionName({ task: 'Add dark mode to settings page please' }, [])).toBe('Add dark mode to settings')
    expect(dispatchedSessionName({ name: 'Fix login', task: 'x' }, ['Fix login'])).toBe('Fix login 2')
    expect(dispatchedSessionName({ task: '!!!' }, [])).toBe('Dispatched session')
  })
})

describe('dispatch_session', () => {
  it('creates a worktree session in the caller\'s project, quietly, and starts its agent on the task', async () => {
    const origin = session()
    persisted['proj-A'] = [origin]
    useSessionStore.setState({ sessions: [origin], currentProjectId: 'proj-A', activeSessionId: 'sess-1' } as any)

    const res = await handleSessionDispatchRequest(dispatch({ name: 'Fix login redirect' }))
    expect(res.ok).toBe(true)

    expect(api.worktree.create).toHaveBeenCalledWith('/repo/A', 'Fix login redirect', undefined, undefined)
    const created = persisted['proj-A'].find((s) => s.name === 'Fix login redirect')!
    expect(created).toMatchObject({
      branchName: 'session/fix-login-redirect',
      worktreePath: '/wt/fix-login-redirect',
      ownsBranch: true,
      dispatchedBy: { sessionId: 'sess-1', name: 'Planning chat' },
    })
    expect(created.location).toBeUndefined()
    expect(created.repoRoot).toBeUndefined()

    // Shown in the sidebar, but the user's view stays where it was.
    expect(useSessionStore.getState().sessions.map((s) => s.id)).toContain(created.id)
    expect(useSessionStore.getState().activeSessionId).toBe('sess-1')

    // Hook routing registered and the agent started with the task as its first message.
    expect(api.notification.registerSession).toHaveBeenCalledWith(created.id, created.name, 'proj-A', created.worktreePath)
    const startOpts = api.visualAgent.start.mock.calls[0][0] as unknown as Record<string, unknown>
    expect(startOpts.sessionId).toBe(created.id)
    expect(startOpts.cwd).toBe('/wt/fix-login-redirect')
    expect(startOpts.initialPrompt).toBe('Fix the login redirect')

    if (res.ok) {
      expect(res.text).toContain(created.id)
      expect(res.text).toContain('session/fix-login-redirect')
    }
    expect(useToastStore.getState().toasts[0].message).toContain('Planning chat started session "Fix login redirect"')
  })

  it('works for a project that is not on screen, writing to its saved list', async () => {
    persisted['proj-B'] = [session({ id: 'sess-b', projectId: 'proj-B', worktreePath: '/repo/B' })]
    useSessionStore.setState({ sessions: [], currentProjectId: 'proj-A' } as any)

    const res = await handleSessionDispatchRequest(dispatch({}, 'sess-b'))
    expect(res.ok).toBe(true)
    expect(api.worktree.create.mock.calls[0][0]).toBe('/repo/B')
    expect(persisted['proj-B']).toHaveLength(2)
    expect(useSessionStore.getState().sessions).toEqual([])
  })

  it('creates a no-worktree session in the main checkout', async () => {
    persisted['proj-A'] = [session()]
    const res = await handleSessionDispatchRequest(dispatch({ worktree: false, name: 'Research' }))
    expect(res.ok).toBe(true)
    expect(api.worktree.create).not.toHaveBeenCalled()
    const created = persisted['proj-A'].find((s) => s.name === 'Research')!
    expect(created).toMatchObject({ repoRoot: true, branchName: '', worktreePath: '/repo/A' })
  })

  it('creates an orchestrator session whose agent gets the orchestrator prompt', async () => {
    persisted['proj-A'] = [session()]
    await handleSessionDispatchRequest(dispatch({ mode: 'orchestrator', name: 'Big refactor' }))
    const created = persisted['proj-A'].find((s) => s.name === 'Big refactor')!
    expect(created.mode).toBe('orchestrator')
    const startOpts = api.visualAgent.start.mock.calls[0][0] as unknown as Record<string, unknown>
    expect(startOpts.orchestratorBranch).toBe('session/big-refactor')
  })

  it('creates a cloud session and starts its create straight away instead of a local agent', async () => {
    persisted['proj-A'] = [session()]
    const res = await handleSessionDispatchRequest(dispatch({ location: 'cloud', name: 'Cloud task', branchName: 'feat/cloud' }))
    expect(res.ok).toBe(true)
    const created = persisted['proj-A'].find((s) => s.name === 'Cloud task')!
    expect(created.location).toBe('cloud')
    expect(created.cloudPending).toMatchObject({ task: 'Fix the login redirect', branch: 'feat/cloud' })
    expect(api.cloudSession.start).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: created.id, branch: 'feat/cloud', task: 'Fix the login redirect', worktreePath: created.worktreePath })
    )
    expect(api.visualAgent.start).not.toHaveBeenCalled()
    expect(useCloudSessionStore.getState().creates[created.id]?.terminalId).toBe('term-9')
  })

  it('works from the Code workspace', async () => {
    persisted['proj-B'] = []
    const res = await handleSessionDispatchRequest(dispatch({ name: 'From code' }, 'code-editor:proj-B'))
    expect(res.ok).toBe(true)
    expect(persisted['proj-B'][0].dispatchedBy).toEqual({ name: 'Code workspace' })
  })

  it('reports errors back instead of throwing', async () => {
    persisted['proj-A'] = [session()]
    api.worktree.create.mockRejectedValueOnce(new Error('A branch named "x" already exists'))
    const res = await handleSessionDispatchRequest(dispatch({}))
    expect(res).toEqual({ ok: false, error: 'A branch named "x" already exists' })
    expect(persisted['proj-A']).toHaveLength(1)

    const unknown = await handleSessionDispatchRequest(dispatch({}, 'nobody'))
    expect(unknown.ok).toBe(false)
  })
})

describe('list_sessions', () => {
  it('lists the caller\'s project and marks the caller', async () => {
    persisted['proj-A'] = [
      session(),
      session({ id: 'sess-2', name: 'Child', branchName: 'session/child', repoRoot: undefined, dispatchedBy: { sessionId: 'sess-1', name: 'Planning chat' } }),
    ]
    const res = await handleSessionDispatchRequest({ id: 'r', contextId: 'sess-1', tool: 'list_sessions', args: {} })
    expect(res.ok).toBe(true)
    const parsed = JSON.parse((res as { text: string }).text)
    expect(parsed.project).toBe('A')
    expect(parsed.sessions[0]).toMatchObject({ id: 'sess-1', thisSession: true, worktree: false, branch: null })
    expect(parsed.sessions[1]).toMatchObject({ id: 'sess-2', dispatchedBy: 'Planning chat', branch: 'session/child', runs: 'local' })
  })
})

describe('send_to_session', () => {
  it('sends to a local session\'s agent', async () => {
    persisted['proj-A'] = [session(), session({ id: 'sess-2', name: 'Child', repoRoot: undefined, worktreePath: '/wt/child' })]
    const res = await handleSessionDispatchRequest({ id: 'r', contextId: 'sess-1', tool: 'send_to_session', args: { sessionId: 'sess-2', message: 'Also add tests' } })
    expect(res).toEqual({ ok: true, text: 'Sent to "Child".' })
    const startOpts = api.visualAgent.start.mock.calls[0][0] as unknown as Record<string, unknown>
    expect(startOpts.sessionId).toBe('sess-2')
    expect(startOpts.initialPrompt).toBe('Also add tests')
  })

  it('sends to a cloud session through Claude Code on the web', async () => {
    persisted['proj-A'] = [
      session(),
      session({ id: 'sess-3', name: 'Cloudy', location: 'cloud', cloud: { sessionId: 'cloud-1', url: 'u' } as any }),
    ]
    const res = await handleSessionDispatchRequest({ id: 'r', contextId: 'sess-1', tool: 'send_to_session', args: { sessionId: 'sess-3', message: 'hi' } })
    expect(res.ok).toBe(true)
    expect(api.cloudSession.send).toHaveBeenCalledWith(expect.objectContaining({ cloudSessionId: 'cloud-1', message: 'hi' }))
  })

  it('refuses itself, unknown ids and cloud sessions still being created', async () => {
    persisted['proj-A'] = [session(), session({ id: 'sess-4', name: 'Pending', location: 'cloud' })]
    const self = await handleSessionDispatchRequest({ id: 'r', contextId: 'sess-1', tool: 'send_to_session', args: { sessionId: 'sess-1', message: 'hi' } })
    expect(self.ok).toBe(false)
    const missing = await handleSessionDispatchRequest({ id: 'r', contextId: 'sess-1', tool: 'send_to_session', args: { sessionId: 'zzz', message: 'hi' } })
    expect(missing.ok).toBe(false)
    const pending = await handleSessionDispatchRequest({ id: 'r', contextId: 'sess-1', tool: 'send_to_session', args: { sessionId: 'sess-4', message: 'hi' } })
    expect(pending).toEqual({ ok: false, error: 'The cloud session "Pending" has not finished being created yet.' })
  })
})

describe('assign_pr', () => {
  const assign = (args: { prNumber: number | null; sessionId?: string }, contextId = 'sess-1'): SessionDispatchRequest => ({
    id: 'r',
    contextId,
    tool: 'assign_pr',
    args,
  })

  it('assigns a PR to the calling no-worktree session', async () => {
    persisted['proj-A'] = [session()]
    const res = await handleSessionDispatchRequest(assign({ prNumber: 42 }))
    expect(res.ok).toBe(true)
    expect((res as { text: string }).text).toContain('Assigned PR #42 "Fix login" to "Planning chat"')
    expect(persisted['proj-A'][0].prNumber).toBe(42)
    expect(api.github.listPRs).toHaveBeenCalledWith('/repo/A')
  })

  it('assigns to another session by id, and shows it in list_sessions', async () => {
    persisted['proj-A'] = [session(), session({ id: 'sess-2', name: 'Other chat' })]
    const res = await handleSessionDispatchRequest(assign({ prNumber: 42, sessionId: 'sess-2' }))
    expect(res.ok).toBe(true)
    expect(persisted['proj-A'][1].prNumber).toBe(42)
    expect(persisted['proj-A'][0].prNumber).toBeUndefined()
    const listed = await handleSessionDispatchRequest({ id: 'r', contextId: 'sess-1', tool: 'list_sessions', args: {} })
    expect(JSON.parse((listed as { text: string }).text).sessions[1]).toMatchObject({ id: 'sess-2', assignedPR: 42 })
  })

  it('updates the on-screen session list when the project is shown', async () => {
    persisted['proj-A'] = [session()]
    useSessionStore.setState({ sessions: [session()], currentProjectId: 'proj-A' } as any)
    await handleSessionDispatchRequest(assign({ prNumber: 42 }))
    expect(useSessionStore.getState().sessions[0].prNumber).toBe(42)
  })

  it('unassigns with a null pr number', async () => {
    persisted['proj-A'] = [session({ prNumber: 42 })]
    const res = await handleSessionDispatchRequest(assign({ prNumber: null }))
    expect(res).toEqual({ ok: true, text: 'Unassigned PR #42 from "Planning chat".' })
    expect('prNumber' in persisted['proj-A'][0]).toBe(false)
  })

  it('refuses worktree sessions, unknown PRs and unknown sessions', async () => {
    persisted['proj-A'] = [session(), session({ id: 'sess-2', name: 'Child', repoRoot: undefined, branchName: 'session/child', worktreePath: '/wt/child' })]
    const worktree = await handleSessionDispatchRequest(assign({ prNumber: 42, sessionId: 'sess-2' }))
    expect(worktree.ok).toBe(false)
    expect((worktree as { error: string }).error).toMatch(/own worktree/)
    const unknownPR = await handleSessionDispatchRequest(assign({ prNumber: 7 }))
    expect(unknownPR.ok).toBe(false)
    expect((unknownPR as { error: string }).error).toMatch(/PR #7/)
    const unknownSession = await handleSessionDispatchRequest(assign({ prNumber: 42, sessionId: 'zzz' }))
    expect(unknownSession.ok).toBe(false)
    expect(persisted['proj-A'].every((s) => s.prNumber === undefined)).toBe(true)
  })

  it('needs a session id from the Code workspace', async () => {
    const res = await handleSessionDispatchRequest(assign({ prNumber: 42 }, 'code-editor:proj-A'))
    expect(res.ok).toBe(false)
    expect((res as { error: string }).error).toMatch(/session_id/)
  })
})
