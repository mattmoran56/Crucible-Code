import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getAppAction,
  getAppActions,
  getAppActionGroups,
} from '../../../src/renderer/stores/appActions'
import { useSessionStore } from '../../../src/renderer/stores/sessionStore'
import { useProjectStore } from '../../../src/renderer/stores/projectStore'
import { useWorkspaceLayoutStore } from '../../../src/renderer/stores/workspaceLayoutStore'
import { useSettingsStore } from '../../../src/renderer/stores/settingsStore'

beforeEach(() => {
  ;(window as any).api = {} // touched only by stores when sessions/projects are set
  useSessionStore.setState({ sessions: [], activeSessionId: null } as any)
  useProjectStore.setState({ projects: [], activeProjectId: null, claudeAccounts: [] } as any)
  useWorkspaceLayoutStore.setState({ columns: [{ id: 'c1', tabs: [], activeTab: undefined, flex: 1 }], savedLayouts: {} } as any)
  useSettingsStore.setState({ isOpen: false } as any)
})

describe('getAppActions', () => {
  it('returns a non-empty list', () => {
    expect(getAppActions().length).toBeGreaterThan(0)
  })

  it('every action has the required metadata', () => {
    for (const a of getAppActions()) {
      expect(typeof a.id).toBe('string')
      expect(typeof a.label).toBe('string')
      expect(typeof a.group).toBe('string')
      expect(Array.isArray(a.validPlacements)).toBe(true)
      expect(typeof a.execute).toBe('function')
    }
  })

  it('every action id is unique', () => {
    const ids = getAppActions().map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('exposes the well-known session/tabs/project/app actions', () => {
    const ids = getAppActions().map((a) => a.id)
    expect(ids).toContain('session:create')
    expect(ids).toContain('session:delete')
    expect(ids).toContain('tab:open-agent')
    expect(ids).toContain('tab:open-terminal')
    expect(ids).toContain('tab:split-right')
    expect(ids).toContain('project:add')
    expect(ids).toContain('app:open-settings')
  })
})

describe('getAppAction', () => {
  it('returns the matching action when present', () => {
    expect(getAppAction('app:open-settings')).toBeDefined()
    expect(getAppAction('app:open-settings')!.label).toBe('Open Settings')
  })

  it('returns undefined for unknown ids', () => {
    expect(getAppAction('does-not-exist')).toBeUndefined()
  })
})

describe('getAppActionGroups', () => {
  it('groups by the .group field, preserving every action', () => {
    const groups = getAppActionGroups()
    const total = groups.reduce((sum, g) => sum + g.actions.length, 0)
    expect(total).toBe(getAppActions().length)
    for (const g of groups) {
      for (const a of g.actions) expect(a.group).toBe(g.group)
    }
  })
})

describe('action.execute (side effects)', () => {
  it('app:open-settings opens the settings dialog', () => {
    const action = getAppAction('app:open-settings')!
    action.execute()
    expect(useSettingsStore.getState().isOpen).toBe(true)
  })

  it('tab:open-agent adds an agent tab to the first column', () => {
    const action = getAppAction('tab:open-agent')!
    action.execute()
    const cols = useWorkspaceLayoutStore.getState().columns
    expect(cols[0].tabs.some((t) => t === 'agent' || t.toString().startsWith('agent:'))).toBe(true)
  })

  it('tab:open-terminal adds a terminal tab to the first column', () => {
    const action = getAppAction('tab:open-terminal')!
    action.execute()
    const cols = useWorkspaceLayoutStore.getState().columns
    expect(cols[0].tabs.some((t) => t.toString().startsWith('terminal:'))).toBe(true)
  })

  it('tab:split-right adds a new column', () => {
    const action = getAppAction('tab:split-right')!
    action.execute()
    expect(useWorkspaceLayoutStore.getState().columns.length).toBe(2)
  })

  it('session:create dispatches a window event', () => {
    const handler = vi.fn()
    window.addEventListener('app:create-session', handler)
    getAppAction('session:create')!.execute()
    expect(handler).toHaveBeenCalled()
    window.removeEventListener('app:create-session', handler)
  })

  it('app:toggle-notes dispatches an app:toggle-panel event with the right detail', () => {
    let detail: any = null
    window.addEventListener('app:toggle-panel', (e) => { detail = (e as CustomEvent).detail }, { once: true })
    getAppAction('app:toggle-notes')!.execute()
    expect(detail).toEqual({ panel: 'notes' })
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Extended coverage (appended). Imports below are hoisted by ESM semantics;
// stores already imported at the top of this file are reused directly.
// ───────────────────────────────────────────────────────────────────────────
import { usePRStore } from '../../../src/renderer/stores/prStore'
import { useReviewLoopStore } from '../../../src/renderer/stores/reviewLoopStore'
import { useToastStore } from '../../../src/renderer/stores/toastStore'

/** Temporarily replace a zustand store action with a vi.fn(). */
function stubAction(store: { getState: () => any; setState: (s: any) => void }, key: string) {
  const original = store.getState()[key]
  const mock = vi.fn()
  store.setState({ [key]: mock })
  return { mock, restore: () => store.setState({ [key]: original }) }
}

describe('appActions session/project wiring', () => {
  const restores: Array<() => void> = []
  const stub = (store: any, key: string) => {
    const s = stubAction(store, key)
    restores.push(s.restore)
    return s.mock
  }

  afterEach(() => {
    while (restores.length) restores.pop()!()
  })

  beforeEach(() => {
    useProjectStore.setState({
      projects: [{ id: 'p1', name: 'proj', repoPath: '/repo' }],
      activeProjectId: 'p1',
    } as any)
    useSessionStore.setState({
      sessions: [{
        id: 's1', name: 'work', branchName: 'feat/x', worktreePath: '/wt/s1',
        projectId: 'p1', createdAt: 'now',
      }],
      activeSessionId: 's1',
    } as any)
  })

  it('session:open-as-main forwards repoPath and the active session id', () => {
    const mock = stub(useSessionStore, 'openAsMainBranch')
    getAppAction('session:open-as-main')!.execute()
    expect(mock).toHaveBeenCalledWith('/repo', 's1')
  })

  it('session:open-as-main does nothing when the active project is missing from the list', () => {
    const mock = stub(useSessionStore, 'openAsMainBranch')
    useProjectStore.setState({ projects: [], activeProjectId: 'p1' } as any)
    getAppAction('session:open-as-main')!.execute()
    expect(mock).not.toHaveBeenCalled()
  })

  it('session:return-to-worktree forwards the repoPath', () => {
    const mock = stub(useSessionStore, 'returnToWorktree')
    getAppAction('session:return-to-worktree')!.execute()
    expect(mock).toHaveBeenCalledWith('/repo')
  })

  it('session:return-to-worktree does nothing without a resolvable project', () => {
    const mock = stub(useSessionStore, 'returnToWorktree')
    useProjectStore.setState({ projects: [], activeProjectId: null } as any)
    getAppAction('session:return-to-worktree')!.execute()
    expect(mock).not.toHaveBeenCalled()
  })

  it('session:delete forwards projectId, repoPath and sessionId to removeSession', () => {
    const mock = stub(useSessionStore, 'removeSession')
    getAppAction('session:delete')!.execute()
    expect(mock).toHaveBeenCalledWith('p1', '/repo', 's1')
  })

  it('session:delete and project:remove carry default confirm messages', () => {
    expect(getAppAction('session:delete')!.defaultConfirmMessage).toMatch(/cannot be undone/i)
    expect(getAppAction('project:remove')!.defaultConfirmMessage).toMatch(/repository will not be deleted/i)
  })

  it('project:remove removes the active project', () => {
    const mock = stub(useProjectStore, 'removeProject')
    getAppAction('project:remove')!.execute()
    expect(mock).toHaveBeenCalledWith('p1')
  })

  it('project:remove does nothing without an active project', () => {
    const mock = stub(useProjectStore, 'removeProject')
    useProjectStore.setState({ activeProjectId: null } as any)
    getAppAction('project:remove')!.execute()
    expect(mock).not.toHaveBeenCalled()
  })

  it('project:add triggers the folder-picking flow', () => {
    const mock = stub(useProjectStore, 'addProject')
    getAppAction('project:add')!.execute()
    expect(mock).toHaveBeenCalled()
  })
})

describe('appActions tab switching', () => {
  beforeEach(() => {
    useWorkspaceLayoutStore.setState({
      columns: [{ id: 'c1', tabs: ['agent', 'git', 'pr', 'review', 'code'], activeTab: 'agent', flex: 1 }],
      savedLayouts: {},
    } as any)
  })

  it('tab:switch-git activates the git tab on the first column', () => {
    getAppAction('tab:switch-git')!.execute()
    expect(useWorkspaceLayoutStore.getState().columns[0].activeTab).toBe('git')
  })

  it('tab:switch-pr activates the pr tab', () => {
    getAppAction('tab:switch-pr')!.execute()
    expect(useWorkspaceLayoutStore.getState().columns[0].activeTab).toBe('pr')
  })

  it('tab:switch-review activates the review tab', () => {
    getAppAction('tab:switch-review')!.execute()
    expect(useWorkspaceLayoutStore.getState().columns[0].activeTab).toBe('review')
  })

  it('tab:switch-code activates the code tab', () => {
    getAppAction('tab:switch-code')!.execute()
    expect(useWorkspaceLayoutStore.getState().columns[0].activeTab).toBe('code')
  })

  it('tab:switch-agent activates the agent tab from elsewhere', () => {
    useWorkspaceLayoutStore.getState().setActiveTab('c1', 'git')
    getAppAction('tab:switch-agent')!.execute()
    expect(useWorkspaceLayoutStore.getState().columns[0].activeTab).toBe('agent')
  })

  it('tab switches are safe no-ops when no columns exist', () => {
    useWorkspaceLayoutStore.setState({ columns: [] } as any)
    expect(() => getAppAction('tab:switch-git')!.execute()).not.toThrow()
    expect(useWorkspaceLayoutStore.getState().columns).toEqual([])
  })
})

describe('appActions review-loop actions', () => {
  const restores: Array<() => void> = []
  const stub = (store: any, key: string) => {
    const s = stubAction(store, key)
    restores.push(s.restore)
    return s.mock
  }

  afterEach(() => {
    while (restores.length) restores.pop()!()
  })

  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
    usePRStore.setState({ pullRequests: [] } as any)
    useProjectStore.setState({
      projects: [{ id: 'p1', name: 'proj', repoPath: '/repo' }],
      activeProjectId: 'p1',
    } as any)
    useSessionStore.setState({
      sessions: [{
        id: 's1', name: 'work', branchName: 'feat/x', worktreePath: '/wt/s1',
        projectId: 'p1', createdAt: 'now',
      }],
      activeSessionId: 's1',
    } as any)
    useWorkspaceLayoutStore.setState({
      columns: [
        { id: 'c1', tabs: ['agent'], activeTab: 'agent', flex: 1 },
        { id: 'c2', tabs: ['review-loop'], activeTab: undefined, flex: 1 },
      ],
      savedLayouts: {},
    } as any)
  })

  it('review-loop:cancel cancels the loop for the active session', async () => {
    const mock = stub(useReviewLoopStore, 'cancel')
    await getAppAction('review-loop:cancel')!.execute()
    expect(mock).toHaveBeenCalledWith('s1')
  })

  it('review-loop:cancel is a no-op without an active session', async () => {
    const mock = stub(useReviewLoopStore, 'cancel')
    useSessionStore.setState({ activeSessionId: null } as any)
    await getAppAction('review-loop:cancel')!.execute()
    expect(mock).not.toHaveBeenCalled()
  })

  it('review-loop:toggle-tab activates the column hosting the review-loop tab', () => {
    getAppAction('review-loop:toggle-tab')!.execute()
    expect(useWorkspaceLayoutStore.getState().columns[1].activeTab).toBe('review-loop')
  })

  it('review-loop:toggle-tab toasts info when no review-loop tab exists', () => {
    useWorkspaceLayoutStore.setState({
      columns: [{ id: 'c1', tabs: ['agent'], activeTab: 'agent', flex: 1 }],
    } as any)
    getAppAction('review-loop:toggle-tab')!.execute()
    expect(useToastStore.getState().toasts[0]).toMatchObject({
      type: 'info',
      message: 'Review Loop tab is only available with an active session',
    })
  })

  it('review-loop:start prefers the session baseBranch and the matching PR number', async () => {
    const mock = stub(useReviewLoopStore, 'start')
    useSessionStore.setState({
      sessions: [{
        id: 's1', name: 'work', branchName: 'feat/x', worktreePath: '/wt/s1',
        projectId: 'p1', createdAt: 'now', baseBranch: 'develop', prNumber: 12,
      }],
      activeSessionId: 's1',
    } as any)
    usePRStore.setState({
      pullRequests: [{ number: 9, headRefName: 'feat/x', baseRefName: 'release' }],
    } as any)
    await getAppAction('review-loop:start')!.execute()
    expect(mock).toHaveBeenCalledWith({
      sessionId: 's1',
      worktreePath: '/wt/s1',
      branch: 'feat/x',
      baseBranch: 'develop',
      projectId: 'p1',
      prNumber: 9,
    })
  })

  it('review-loop:start falls back to the PR baseRefName when the session has none', async () => {
    const mock = stub(useReviewLoopStore, 'start')
    usePRStore.setState({
      pullRequests: [{ number: 9, headRefName: 'feat/x', baseRefName: 'release' }],
    } as any)
    await getAppAction('review-loop:start')!.execute()
    expect(mock.mock.calls[0][0]).toMatchObject({ baseBranch: 'release', prNumber: 9 })
  })

  it('review-loop:start defaults to main and the session prNumber without a matching PR', async () => {
    const mock = stub(useReviewLoopStore, 'start')
    useSessionStore.setState({
      sessions: [{
        id: 's1', name: 'work', branchName: 'feat/x', worktreePath: '/wt/s1',
        projectId: 'p1', createdAt: 'now', prNumber: 33,
      }],
      activeSessionId: 's1',
    } as any)
    await getAppAction('review-loop:start')!.execute()
    expect(mock.mock.calls[0][0]).toMatchObject({ baseBranch: 'main', prNumber: 33 })
  })

  it('review-loop:start focuses the review-loop tab before starting', async () => {
    stub(useReviewLoopStore, 'start')
    await getAppAction('review-loop:start')!.execute()
    expect(useWorkspaceLayoutStore.getState().columns[1].activeTab).toBe('review-loop')
  })

  it('review-loop:start aborts when the active session cannot be resolved', async () => {
    const mock = stub(useReviewLoopStore, 'start')
    useSessionStore.setState({ activeSessionId: 'ghost' } as any)
    await getAppAction('review-loop:start')!.execute()
    expect(mock).not.toHaveBeenCalled()
  })

  it('review-loop:start declares both session and project requirements', () => {
    const def = getAppAction('review-loop:start')!
    expect(def.requiresActiveSession).toBe(true)
    expect(def.requiresActiveProject).toBe(true)
  })
})

describe('appActions metadata invariants', () => {
  it('every validPlacements entry is a known placement', () => {
    const known = new Set(['session-toolbar', 'project-tabs', 'right-activity-bar'])
    for (const a of getAppActions()) {
      expect(a.validPlacements.length).toBeGreaterThan(0)
      for (const p of a.validPlacements) expect(known.has(p)).toBe(true)
    }
  })

  it('app:toggle-usage dispatches the usage panel toggle event', () => {
    let detail: any = null
    window.addEventListener('app:toggle-panel', (e) => { detail = (e as CustomEvent).detail }, { once: true })
    getAppAction('app:toggle-usage')!.execute()
    expect(detail).toEqual({ panel: 'usage' })
  })

  it('app:toggle-permissions dispatches the permissions panel toggle event', () => {
    let detail: any = null
    window.addEventListener('app:toggle-panel', (e) => { detail = (e as CustomEvent).detail }, { once: true })
    getAppAction('app:toggle-permissions')!.execute()
    expect(detail).toEqual({ panel: 'permissions' })
  })
})
