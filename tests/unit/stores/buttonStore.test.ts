import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useButtonStore } from '../../../src/renderer/stores/buttonStore'
import { useToastStore } from '../../../src/renderer/stores/toastStore'

const buttonApi = {
  list: vi.fn(),
  save: vi.fn(),
  groupList: vi.fn(),
  groupSave: vi.fn(),
  execute: vi.fn(),
}
const terminalApi = {
  onData: vi.fn().mockReturnValue(() => {}),
  onExit: vi.fn().mockReturnValue(() => {}),
  write: vi.fn(),
  kill: vi.fn(),
}

beforeEach(() => {
  for (const fn of Object.values(buttonApi)) (fn as any).mockReset()
  ;(window as any).api = { button: buttonApi, terminal: terminalApi }
  useButtonStore.setState({ buttons: [], groups: [], runningButtons: {} } as any)
  useToastStore.setState({ toasts: [] })
  // loadButtons seeds built-in buttons (e.g. Review Loop) on first run; mark
  // the workspace as already seeded so these tests assert against the API
  // result alone, not the merged seed list. Use a try/catch since some test
  // envs stub localStorage without a real setItem.
  try {
    globalThis.localStorage?.setItem('codecrucible.builtin-buttons.seeded', '1')
  } catch {
    // jsdom localStorage missing — fall back to a stub for this test.
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => (k === 'codecrucible.builtin-buttons.seeded' ? '1' : null),
        setItem: () => {},
        removeItem: () => {},
        clear: () => {},
      },
    })
  }
})

const B = (overrides: Partial<{ id: string; placement: string; order: number; groupId?: string; scope: any }> = {}) => ({
  id: 'b1',
  label: 'Test',
  command: 'echo hi',
  placement: 'session-toolbar',
  scope: { type: 'global' },
  actionType: 'shell',
  executionMode: 'background',
  order: 0,
  ...overrides,
}) as any

const G = (overrides: Partial<{ id: string; placement: string; order: number; scope: any }> = {}) => ({
  id: 'g1',
  label: 'My Group',
  placement: 'session-toolbar',
  scope: { type: 'global' },
  order: 0,
  ...overrides,
}) as any

describe('buttonStore.loadButtons / loadGroups', () => {
  it('loadButtons stores api result', async () => {
    buttonApi.list.mockResolvedValue([B({ id: 'b1' })])
    await useButtonStore.getState().loadButtons()
    expect(useButtonStore.getState().buttons).toHaveLength(1)
  })

  it('loadButtons toasts on error', async () => {
    buttonApi.list.mockRejectedValue(new Error('disk full'))
    await useButtonStore.getState().loadButtons()
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: 'error', message: 'disk full' })
  })

  it('loadGroups stores api result', async () => {
    buttonApi.groupList.mockResolvedValue([G({ id: 'g1' })])
    await useButtonStore.getState().loadGroups()
    expect(useButtonStore.getState().groups).toHaveLength(1)
  })
})

describe('buttonStore.add/update/remove (buttons + groups)', () => {
  it('addButton appends and persists', async () => {
    buttonApi.save.mockResolvedValue(undefined)
    await useButtonStore.getState().addButton(B({ id: 'b1' }))
    expect(useButtonStore.getState().buttons).toHaveLength(1)
    expect(buttonApi.save).toHaveBeenCalled()
  })

  it('updateButton replaces by id', async () => {
    buttonApi.save.mockResolvedValue(undefined)
    useButtonStore.setState({
      buttons: [B({ id: 'b1' }), B({ id: 'b2' })],
      groups: [], runningButtons: {},
    } as any)
    await useButtonStore.getState().updateButton(B({ id: 'b1', label: 'updated' as any } as any))
    const b = useButtonStore.getState().buttons.find((x: any) => x.id === 'b1') as any
    expect(b.label).toBe('updated')
  })

  it('removeButton drops by id', async () => {
    buttonApi.save.mockResolvedValue(undefined)
    useButtonStore.setState({
      buttons: [B({ id: 'b1' }), B({ id: 'b2' })],
      groups: [], runningButtons: {},
    } as any)
    await useButtonStore.getState().removeButton('b1')
    expect(useButtonStore.getState().buttons.map((x: any) => x.id)).toEqual(['b2'])
  })

  it('removeGroup ungroups its buttons', async () => {
    buttonApi.save.mockResolvedValue(undefined)
    buttonApi.groupSave.mockResolvedValue(undefined)
    useButtonStore.setState({
      buttons: [B({ id: 'b1', groupId: 'g1' }), B({ id: 'b2' })],
      groups: [G({ id: 'g1' })],
      runningButtons: {},
    } as any)
    await useButtonStore.getState().removeGroup('g1')
    expect(useButtonStore.getState().groups).toEqual([])
    const b1 = useButtonStore.getState().buttons.find((b: any) => b.id === 'b1') as any
    expect(b1.groupId).toBeUndefined()
  })
})

describe('buttonStore.reorderButtons', () => {
  it('rewrites the order index for buttons in the placement', async () => {
    buttonApi.save.mockResolvedValue(undefined)
    useButtonStore.setState({
      buttons: [
        B({ id: 'b1', order: 0 }),
        B({ id: 'b2', order: 1 }),
        B({ id: 'b3', order: 2, placement: 'project-tabs' as any }),
      ],
      groups: [], runningButtons: {},
    } as any)
    await useButtonStore.getState().reorderButtons('session-toolbar' as any, ['b2', 'b1'])
    const sessionButtons = useButtonStore.getState().buttons.filter((b: any) => b.placement === 'session-toolbar')
    expect(sessionButtons.find((b: any) => b.id === 'b2').order).toBe(0)
    expect(sessionButtons.find((b: any) => b.id === 'b1').order).toBe(1)
    // project-tabs button untouched
    expect(useButtonStore.getState().buttons.find((b: any) => b.id === 'b3').order).toBe(2)
  })
})

describe('buttonStore.getButtonsForPlacement / getGroupedButtons', () => {
  it('filters by placement and scope, sorts by order', () => {
    useButtonStore.setState({
      buttons: [
        B({ id: 'b1', placement: 'session-toolbar' as any, order: 1 }),
        B({ id: 'b2', placement: 'session-toolbar' as any, order: 0 }),
        B({ id: 'b3', placement: 'project-tabs' as any, order: 0 }),
        B({ id: 'b4', placement: 'session-toolbar' as any, order: 2, scope: { type: 'projects', projectIds: ['p1'] } }),
      ],
      groups: [], runningButtons: {},
    } as any)
    const result = useButtonStore.getState().getButtonsForPlacement('session-toolbar' as any, null)
    // b4 requires p1, null scope filters it out; b2 then b1 by order
    expect(result.map((b: any) => b.id)).toEqual(['b2', 'b1'])
  })

  it('matches projects scope correctly', () => {
    useButtonStore.setState({
      buttons: [
        B({ id: 'b1', scope: { type: 'projects', projectIds: ['p1'] } as any }),
        B({ id: 'b2', scope: { type: 'projects', projectIds: ['p2'] } as any }),
        B({ id: 'b3', scope: { type: 'all-projects' } as any }),
      ],
      groups: [], runningButtons: {},
    } as any)
    const ids = useButtonStore.getState().getButtonsForPlacement('session-toolbar' as any, 'p1').map((b: any) => b.id)
    expect(ids).toContain('b1')
    expect(ids).toContain('b3')
    expect(ids).not.toContain('b2')
  })

  it('groups buttons under their groups and lists ungrouped separately', () => {
    useButtonStore.setState({
      buttons: [
        B({ id: 'b1', groupId: 'g1', order: 0 }),
        B({ id: 'b2', groupId: 'g1', order: 1 }),
        B({ id: 'b3', order: 2 }),
      ],
      groups: [G({ id: 'g1', order: 0 })],
      runningButtons: {},
    } as any)
    const { ungrouped, groups } = useButtonStore.getState().getGroupedButtons('session-toolbar' as any, null)
    expect(ungrouped.map((b: any) => b.id)).toEqual(['b3'])
    expect(groups[0].group.id).toBe('g1')
    expect(groups[0].buttons.map((b: any) => b.id)).toEqual(['b1', 'b2'])
  })
})

describe('buttonStore.setButtonRunState', () => {
  it('sets and clears running state', () => {
    useButtonStore.getState().setButtonRunState('b1', { terminalId: 't1', running: true })
    expect(useButtonStore.getState().runningButtons.b1).toEqual({ terminalId: 't1', running: true })
    useButtonStore.getState().setButtonRunState('b1', null)
    expect(useButtonStore.getState().runningButtons.b1).toBeUndefined()
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Extended coverage (appended). Imports below are hoisted by ESM semantics.
// ───────────────────────────────────────────────────────────────────────────
import { useSessionStore } from '../../../src/renderer/stores/sessionStore'
import { useProjectStore } from '../../../src/renderer/stores/projectStore'
import { useWorkspaceLayoutStore } from '../../../src/renderer/stores/workspaceLayoutStore'
import { useTerminalStore } from '../../../src/renderer/stores/terminalStore'
import { useReviewLoopStore } from '../../../src/renderer/stores/reviewLoopStore'
import { useSettingsStore } from '../../../src/renderer/stores/settingsStore'
import { DEFAULT_REVIEW_LOOP_CONFIG } from '../../../src/shared/types'

const SESSION = {
  id: 's1',
  name: 'feat-work',
  branchName: 'session/feat-work',
  worktreePath: '/wt/feat-work',
  projectId: 'p1',
  createdAt: '2024-01-01T00:00:00.000Z',
} as any

const PROJECT = { id: 'p1', name: 'my-proj', repoPath: '/repo/my-proj' } as any

describe('buttonStore.loadButtons (seeding + dedupe)', () => {
  beforeEach(() => {
    // file-level beforeEach marks the workspace as seeded; individual tests
    // below unset that flag when they exercise the seeding path.
    useToastStore.setState({ toasts: [] })
  })

  it('dedupes concurrent loads onto one in-flight request', async () => {
    let resolve: (v: any) => void = () => {}
    buttonApi.list.mockImplementationOnce(() => new Promise((r) => { resolve = r }))
    const first = useButtonStore.getState().loadButtons()
    const second = useButtonStore.getState().loadButtons()
    expect(buttonApi.list).toHaveBeenCalledTimes(1)
    resolve([B({ id: 'b1' })])
    await Promise.all([first, second])
    expect(useButtonStore.getState().buttons).toHaveLength(1)
  })

  it('seeds the built-in Review Loop button on a fresh workspace and persists it', async () => {
    localStorage.removeItem('codecrucible.builtin-buttons.seeded')
    buttonApi.list.mockResolvedValue([])
    buttonApi.save.mockResolvedValue(undefined)
    await useButtonStore.getState().loadButtons()
    const seeded = useButtonStore.getState().buttons.find((b: any) => b.id === 'built-in:review-loop:start') as any
    expect(seeded).toMatchObject({
      label: 'Review Loop',
      actionType: 'app-action',
      command: 'review-loop:start',
      placement: 'session-toolbar',
    })
    expect(buttonApi.save).toHaveBeenCalledWith(useButtonStore.getState().buttons)
    expect(localStorage.getItem('codecrucible.builtin-buttons.seeded')).toBe('1')
  })

  it('does not re-seed once the sentinel flag is set (user deleted it)', async () => {
    buttonApi.list.mockResolvedValue([])
    await useButtonStore.getState().loadButtons()
    expect(useButtonStore.getState().buttons).toEqual([])
    expect(buttonApi.save).not.toHaveBeenCalled()
  })

  it('does not duplicate the built-in button when it already exists', async () => {
    localStorage.removeItem('codecrucible.builtin-buttons.seeded')
    const existing = B({ id: 'built-in:review-loop:start' })
    buttonApi.list.mockResolvedValue([existing])
    await useButtonStore.getState().loadButtons()
    expect(useButtonStore.getState().buttons).toHaveLength(1)
    expect(buttonApi.save).not.toHaveBeenCalled()
  })
})

describe('buttonStore.saveButtons / saveGroups error paths', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
  })

  it('saveButtons keeps the optimistic state and toasts when persistence fails', async () => {
    buttonApi.save.mockRejectedValue(new Error('disk full'))
    await useButtonStore.getState().saveButtons([B({ id: 'b1' })])
    expect(useButtonStore.getState().buttons).toHaveLength(1)
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: 'error', message: 'disk full' })
  })

  it('saveGroups keeps the optimistic state and toasts when persistence fails', async () => {
    buttonApi.groupSave.mockRejectedValue(new Error('locked'))
    await useButtonStore.getState().saveGroups([G({ id: 'g1' })])
    expect(useButtonStore.getState().groups).toHaveLength(1)
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: 'error', message: 'locked' })
  })

  it('loadGroups toasts on error and leaves groups unchanged', async () => {
    buttonApi.groupList.mockRejectedValue(new Error('no file'))
    await useButtonStore.getState().loadGroups()
    expect(useButtonStore.getState().groups).toEqual([])
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: 'error', message: 'no file' })
  })

  it('updateGroup replaces the matching group only', async () => {
    buttonApi.groupSave.mockResolvedValue(undefined)
    useButtonStore.setState({ groups: [G({ id: 'g1' }), G({ id: 'g2' })] } as any)
    await useButtonStore.getState().updateGroup(G({ id: 'g2', label: 'Renamed' as any } as any))
    expect((useButtonStore.getState().groups.find((g: any) => g.id === 'g2') as any).label).toBe('Renamed')
    expect((useButtonStore.getState().groups.find((g: any) => g.id === 'g1') as any).label).toBe('My Group')
  })

  it('addGroup appends and persists', async () => {
    buttonApi.groupSave.mockResolvedValue(undefined)
    await useButtonStore.getState().addGroup(G({ id: 'g9' }))
    expect(useButtonStore.getState().groups.map((g: any) => g.id)).toEqual(['g9'])
    expect(buttonApi.groupSave).toHaveBeenCalled()
  })
})

describe('buttonStore.executeButton (shell/claude commands)', () => {
  beforeEach(() => {
    for (const fn of Object.values(terminalApi)) (fn as any).mockReset()
    terminalApi.onData.mockReturnValue(() => {})
    terminalApi.onExit.mockReturnValue(() => {})
    useToastStore.setState({ toasts: [] })
    useSessionStore.setState({ sessions: [SESSION], activeSessionId: 's1' } as any)
    useProjectStore.setState({ projects: [PROJECT], activeProjectId: 'p1', claudeAccounts: [] } as any)
    useWorkspaceLayoutStore.setState({ columns: [{ id: 'c1', tabs: ['agent'], activeTab: 'agent', flex: 1 }] } as any)
    useTerminalStore.setState({ terminals: {} })
  })

  it('does nothing for an unknown button id', async () => {
    await useButtonStore.getState().executeButton('ghost')
    expect(buttonApi.execute).not.toHaveBeenCalled()
  })

  it('resolves every template variable from the active session and project', async () => {
    buttonApi.execute.mockResolvedValue('t1')
    useButtonStore.setState({
      buttons: [B({
        id: 'b1',
        command: 'run {{branch}}|{{worktreePath}}|{{sessionName}}|{{repoPath}}|{{projectName}}',
      })],
    } as any)
    await useButtonStore.getState().executeButton('b1')
    expect(buttonApi.execute).toHaveBeenCalledWith(
      'run session/feat-work|/wt/feat-work|feat-work|/repo/my-proj|my-proj',
      '/wt/feat-work',
      'shell',
      'background',
      's1'
    )
  })

  it('substitutes empty strings when no session or project is active', async () => {
    buttonApi.execute.mockResolvedValue('t1')
    useSessionStore.setState({ sessions: [], activeSessionId: null } as any)
    useProjectStore.setState({ projects: [], activeProjectId: null } as any)
    useButtonStore.setState({ buttons: [B({ id: 'b1', command: 'echo "{{branch}}"' })] } as any)
    await useButtonStore.getState().executeButton('b1')
    expect(buttonApi.execute).toHaveBeenCalledWith('echo ""', '.', 'shell', 'background', 'button-exec')
  })

  it('falls back to the project repoPath as cwd when there is no active session', async () => {
    buttonApi.execute.mockResolvedValue('t1')
    useSessionStore.setState({ sessions: [], activeSessionId: null } as any)
    useButtonStore.setState({ buttons: [B({ id: 'b1' })] } as any)
    await useButtonStore.getState().executeButton('b1')
    expect(buttonApi.execute.mock.calls[0][1]).toBe('/repo/my-proj')
  })

  it('resolves a templated custom cwd', async () => {
    buttonApi.execute.mockResolvedValue('t1')
    useButtonStore.setState({ buttons: [B({ id: 'b1', cwd: '{{repoPath}}/packages/app' } as any)] } as any)
    await useButtonStore.getState().executeButton('b1')
    expect(buttonApi.execute.mock.calls[0][1]).toBe('/repo/my-proj/packages/app')
  })

  it('background run records terminal state and clears it on a clean exit with a success toast', async () => {
    let exitCb: ((tid: string, code: number) => void) | undefined
    const cleanup = vi.fn()
    terminalApi.onExit.mockImplementation((cb: any) => { exitCb = cb; return cleanup })
    buttonApi.execute.mockResolvedValue('t9')
    useButtonStore.setState({ buttons: [B({ id: 'b1', label: 'Lint' as any } as any)] } as any)

    await useButtonStore.getState().executeButton('b1')
    expect(useButtonStore.getState().runningButtons.b1).toEqual({ terminalId: 't9', running: true })

    exitCb!('t9', 0)
    expect(useButtonStore.getState().runningButtons.b1).toBeUndefined()
    expect(cleanup).toHaveBeenCalled()
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: 'success', message: '"Lint" completed' })
  })

  it('background run toasts an error with the exit code on failure', async () => {
    let exitCb: ((tid: string, code: number) => void) | undefined
    terminalApi.onExit.mockImplementation((cb: any) => { exitCb = cb; return () => {} })
    buttonApi.execute.mockResolvedValue('t9')
    useButtonStore.setState({ buttons: [B({ id: 'b1', label: 'Lint' as any } as any)] } as any)
    await useButtonStore.getState().executeButton('b1')
    exitCb!('t9', 2)
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: 'error', message: '"Lint" failed (exit 2)' })
  })

  it('background exit events for other terminals are ignored', async () => {
    let exitCb: ((tid: string, code: number) => void) | undefined
    terminalApi.onExit.mockImplementation((cb: any) => { exitCb = cb; return () => {} })
    buttonApi.execute.mockResolvedValue('t9')
    useButtonStore.setState({ buttons: [B({ id: 'b1' })] } as any)
    await useButtonStore.getState().executeButton('b1')
    exitCb!('other-terminal', 0)
    expect(useButtonStore.getState().runningButtons.b1).toEqual({ terminalId: 't9', running: true })
    expect(useToastStore.getState().toasts).toEqual([])
  })

  it('foreground shell run opens a dynamic terminal tab and registers the spawned terminal', async () => {
    buttonApi.execute.mockResolvedValue('t5')
    useButtonStore.setState({ buttons: [B({ id: 'b1', executionMode: 'terminal' as any } as any)] } as any)
    await useButtonStore.getState().executeButton('b1')
    const col = useWorkspaceLayoutStore.getState().columns[0]
    const newTab = col.activeTab as string
    expect(newTab.startsWith('terminal:')).toBe(true)
    const inst = useTerminalStore.getState().getDynamicTerminal(newTab, 's1')
    expect(inst).toMatchObject({ terminalId: 't5', sessionId: 's1', sessionName: 'feat-work', mode: 'shell' })
  })

  it('foreground claude run opens an agent tab and registers a claude-mode terminal', async () => {
    buttonApi.execute.mockResolvedValue('t6')
    useButtonStore.setState({
      buttons: [B({ id: 'b1', actionType: 'claude' as any, executionMode: 'terminal' as any } as any)],
    } as any)
    await useButtonStore.getState().executeButton('b1')
    const newTab = useWorkspaceLayoutStore.getState().columns[0].activeTab as string
    expect(newTab.startsWith('agent:')).toBe(true)
    expect(useTerminalStore.getState().getDynamicTerminal(newTab, 's1')!.mode).toBe('claude')
  })

  it('foreground run with no workspace columns registers nothing', async () => {
    buttonApi.execute.mockResolvedValue('t5')
    useWorkspaceLayoutStore.setState({ columns: [] } as any)
    useButtonStore.setState({ buttons: [B({ id: 'b1', executionMode: 'terminal' as any } as any)] } as any)
    await useButtonStore.getState().executeButton('b1')
    expect(useTerminalStore.getState().terminals).toEqual({})
  })

  it('claude foreground writes the command 100ms after detecting a prompt', async () => {
    vi.useFakeTimers()
    let dataCb: ((tid: string, data: string) => void) | undefined
    const unsub = vi.fn()
    terminalApi.onData.mockImplementation((cb: any) => { dataCb = cb; return unsub })
    buttonApi.execute.mockResolvedValue('t7')
    useButtonStore.setState({
      buttons: [B({ id: 'b1', actionType: 'claude' as any, executionMode: 'terminal' as any, command: 'fix the bug' })],
    } as any)
    await useButtonStore.getState().executeButton('b1')

    dataCb!('t7', '> ')
    expect(terminalApi.write).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    expect(terminalApi.write).toHaveBeenCalledWith('t7', 'fix the bug\r')
    expect(unsub).toHaveBeenCalled()
  })

  it('claude foreground ignores output from other terminals and writes once via the 10s fallback', async () => {
    vi.useFakeTimers()
    let dataCb: ((tid: string, data: string) => void) | undefined
    terminalApi.onData.mockImplementation((cb: any) => { dataCb = cb; return () => {} })
    buttonApi.execute.mockResolvedValue('t7')
    useButtonStore.setState({
      buttons: [B({ id: 'b1', actionType: 'claude' as any, executionMode: 'terminal' as any, command: 'go' })],
    } as any)
    await useButtonStore.getState().executeButton('b1')

    dataCb!('not-t7', '> ')
    vi.advanceTimersByTime(9_999)
    expect(terminalApi.write).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(terminalApi.write).toHaveBeenCalledTimes(1)
    expect(terminalApi.write).toHaveBeenCalledWith('t7', 'go\r')
  })

  it('toasts when the execute IPC throws', async () => {
    buttonApi.execute.mockRejectedValue(new Error('spawn failed'))
    useButtonStore.setState({ buttons: [B({ id: 'b1' })] } as any)
    await useButtonStore.getState().executeButton('b1')
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: 'error', message: 'spawn failed' })
    expect(useButtonStore.getState().runningButtons.b1).toBeUndefined()
  })
})

describe('buttonStore.executeButton (app-action buttons)', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
    useSessionStore.setState({ sessions: [], activeSessionId: null } as any)
    useProjectStore.setState({ projects: [], activeProjectId: null, claudeAccounts: [] } as any)
    useSettingsStore.setState({ isOpen: false } as any)
  })

  const AA = (command: string, overrides: Record<string, unknown> = {}) =>
    B({ id: 'app-b', actionType: 'app-action' as any, command, label: 'My Action' as any, ...overrides } as any)

  it('toasts an error for an unknown app action command', async () => {
    useButtonStore.setState({ buttons: [AA('nope:not-real')] } as any)
    await useButtonStore.getState().executeButton('app-b')
    expect(useToastStore.getState().toasts[0]).toMatchObject({
      type: 'error',
      message: 'Unknown app action: nope:not-real',
    })
  })

  it('warns when the action requires an active session and none is selected', async () => {
    useButtonStore.setState({ buttons: [AA('session:open-as-main')] } as any)
    await useButtonStore.getState().executeButton('app-b')
    expect(useToastStore.getState().toasts[0]).toMatchObject({
      type: 'warning',
      message: '"My Action" requires an active session',
    })
  })

  it('warns when the action requires an active project and none is selected', async () => {
    useSessionStore.setState({ activeSessionId: 's1' } as any)
    useButtonStore.setState({ buttons: [AA('session:open-as-main')] } as any)
    await useButtonStore.getState().executeButton('app-b')
    expect(useToastStore.getState().toasts[0]).toMatchObject({
      type: 'warning',
      message: '"My Action" requires an active project',
    })
  })

  it('runs the action when requirements are satisfied', async () => {
    useButtonStore.setState({ buttons: [AA('app:open-settings')] } as any)
    await useButtonStore.getState().executeButton('app-b')
    expect(useSettingsStore.getState().isOpen).toBe(true)
    expect(useToastStore.getState().toasts).toEqual([])
  })

  it('toasts when the action execution rejects', async () => {
    // session:delete returns removeSession's promise; with the killSession IPC
    // missing here it rejects, and executeButton surfaces it as an error toast.
    useSessionStore.setState({
      sessions: [SESSION],
      activeSessionId: 's1',
      currentProjectId: 'p1',
    } as any)
    useProjectStore.setState({ projects: [PROJECT], activeProjectId: 'p1' } as any)
    useTerminalStore.setState({ terminals: {} })
    useButtonStore.setState({ buttons: [AA('session:delete')] } as any)
    await useButtonStore.getState().executeButton('app-b')
    expect(useToastStore.getState().toasts[0].type).toBe('error')
  })
})

describe('buttonStore.cancelButton / viewButtonOutput', () => {
  beforeEach(() => {
    for (const fn of Object.values(terminalApi)) (fn as any).mockReset()
    terminalApi.onData.mockReturnValue(() => {})
    terminalApi.onExit.mockReturnValue(() => {})
    useToastStore.setState({ toasts: [] })
    useSessionStore.setState({ sessions: [SESSION], activeSessionId: 's1' } as any)
    useWorkspaceLayoutStore.setState({ columns: [{ id: 'c1', tabs: ['agent'], activeTab: 'agent', flex: 1 }] } as any)
    useTerminalStore.setState({ terminals: {} })
  })

  it('cancelButton kills the terminal, clears state and toasts the label', () => {
    useButtonStore.setState({
      buttons: [B({ id: 'b1', label: 'Build' as any } as any)],
      runningButtons: { b1: { terminalId: 't1', running: true } },
    } as any)
    useButtonStore.getState().cancelButton('b1')
    expect(terminalApi.kill).toHaveBeenCalledWith('t1')
    expect(useButtonStore.getState().runningButtons.b1).toBeUndefined()
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: 'info', message: '"Build" cancelled' })
  })

  it('cancelButton falls back to a generic label for unknown buttons', () => {
    useButtonStore.setState({
      buttons: [],
      runningButtons: { mystery: { terminalId: 't2', running: true } },
    } as any)
    useButtonStore.getState().cancelButton('mystery')
    expect(useToastStore.getState().toasts[0].message).toBe('"Button" cancelled')
  })

  it('cancelButton is a no-op when the button is not running', () => {
    useButtonStore.getState().cancelButton('b1')
    expect(terminalApi.kill).not.toHaveBeenCalled()
    expect(useToastStore.getState().toasts).toEqual([])
  })

  it('viewButtonOutput re-attaches the running terminal in a fresh dynamic tab', () => {
    useButtonStore.setState({
      buttons: [B({ id: 'b1' })],
      runningButtons: { b1: { terminalId: 't3', running: true } },
    } as any)
    useButtonStore.getState().viewButtonOutput('b1')
    const newTab = useWorkspaceLayoutStore.getState().columns[0].activeTab as string
    expect(newTab.startsWith('terminal:')).toBe(true)
    expect(useTerminalStore.getState().getDynamicTerminal(newTab, 's1')).toMatchObject({
      terminalId: 't3', sessionName: 'feat-work', mode: 'shell',
    })
  })

  it('viewButtonOutput is a no-op when nothing is running for the button', () => {
    const tabsBefore = useWorkspaceLayoutStore.getState().columns[0].tabs.length
    useButtonStore.getState().viewButtonOutput('b1')
    expect(useWorkspaceLayoutStore.getState().columns[0].tabs.length).toBe(tabsBefore)
  })
})

describe('buttonStore review-loop visibility + group scoping', () => {
  beforeEach(() => {
    useReviewLoopStore.setState({
      settings: { workspace: { ...DEFAULT_REVIEW_LOOP_CONFIG }, projectOverrides: {} },
    } as any)
  })

  it('hides the built-in review-loop button when the loop is disabled for the project', () => {
    useReviewLoopStore.setState({
      settings: {
        workspace: { ...DEFAULT_REVIEW_LOOP_CONFIG },
        projectOverrides: { p1: { enabled: false } },
      },
    } as any)
    useButtonStore.setState({
      buttons: [
        B({ id: 'built-in:review-loop:start' }),
        B({ id: 'other', order: 1 }),
      ],
      groups: [], runningButtons: {},
    } as any)
    expect(useButtonStore.getState().getButtonsForPlacement('session-toolbar' as any, 'p1').map((b: any) => b.id))
      .toEqual(['other'])
    // A different project without the override still sees it.
    expect(useButtonStore.getState().getButtonsForPlacement('session-toolbar' as any, 'p2').map((b: any) => b.id))
      .toEqual(['built-in:review-loop:start', 'other'])
  })

  it('hides the built-in button when the workspace default disables the loop', () => {
    useReviewLoopStore.setState({
      settings: { workspace: { ...DEFAULT_REVIEW_LOOP_CONFIG, enabled: false }, projectOverrides: {} },
    } as any)
    useButtonStore.setState({
      buttons: [B({ id: 'built-in:review-loop:start' })],
      groups: [], runningButtons: {},
    } as any)
    expect(useButtonStore.getState().getButtonsForPlacement('session-toolbar' as any, null)).toEqual([])
  })

  it('getGroupedButtons excludes groups in other placements or out-of-scope projects', () => {
    useButtonStore.setState({
      buttons: [B({ id: 'b1', groupId: 'g-project' })],
      groups: [
        G({ id: 'g-project', scope: { type: 'projects', projectIds: ['p2'] } as any }),
        G({ id: 'g-elsewhere', placement: 'project-tabs' as any }),
      ],
      runningButtons: {},
    } as any)
    const { groups } = useButtonStore.getState().getGroupedButtons('session-toolbar' as any, 'p1')
    expect(groups).toEqual([])
  })

  it('getGroupedButtons sorts groups and their buttons by order', () => {
    useButtonStore.setState({
      buttons: [
        B({ id: 'b1', groupId: 'g2', order: 1 }),
        B({ id: 'b2', groupId: 'g2', order: 0 }),
        B({ id: 'b3', groupId: 'g1', order: 5 }),
      ],
      groups: [G({ id: 'g1', order: 1 }), G({ id: 'g2', order: 0 })],
      runningButtons: {},
    } as any)
    const { groups } = useButtonStore.getState().getGroupedButtons('session-toolbar' as any, null)
    expect(groups.map((g) => g.group.id)).toEqual(['g2', 'g1'])
    expect(groups[0].buttons.map((b: any) => b.id)).toEqual(['b2', 'b1'])
    expect(groups[1].buttons.map((b: any) => b.id)).toEqual(['b3'])
  })

  it('buttons with an unknown scope type are filtered out', () => {
    useButtonStore.setState({
      buttons: [B({ id: 'weird', scope: { type: 'whatever' } as any })],
      groups: [], runningButtons: {},
    } as any)
    expect(useButtonStore.getState().getButtonsForPlacement('session-toolbar' as any, 'p1')).toEqual([])
  })
})
