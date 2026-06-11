import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useReviewLoopStore } from '../../../src/renderer/stores/reviewLoopStore'
import { useToastStore } from '../../../src/renderer/stores/toastStore'
import {
  DEFAULT_REVIEW_LOOP_CONFIG,
  type ReviewLoopConfig,
  type ReviewLoopState,
} from '../../../src/shared/types'

const getSettings = vi.fn()
const setSettings = vi.fn()
const start = vi.fn()
const cancel = vi.fn()
const getState = vi.fn()

const ws = (over: Partial<ReviewLoopConfig> = {}): ReviewLoopConfig => ({
  ...DEFAULT_REVIEW_LOOP_CONFIG,
  ...over,
})

const loopState = (sessionId: string, over: Partial<ReviewLoopState> = {}): ReviewLoopState =>
  ({
    sessionId,
    branch: 'feat/x',
    baseBranch: 'main',
    worktreePath: '/wt',
    variant: 'lite',
    status: 'running',
    currentPhase: 'review',
    iteration: 1,
    rounds: [],
    cumulativeCostUsd: 0,
    skippedIssues: [],
    ...over,
  }) as ReviewLoopState

const startArgs = {
  sessionId: 's1',
  worktreePath: '/wt/s1',
  branch: 'feat/x',
  baseBranch: 'main',
  projectId: 'p1',
}

function toasts() {
  return useToastStore.getState().toasts
}

beforeEach(() => {
  for (const fn of [getSettings, setSettings, start, cancel, getState]) fn.mockReset()
  ;(window as any).api = {
    reviewLoop: { getSettings, setSettings, start, cancel, getState },
  }
  useReviewLoopStore.setState({
    settings: { workspace: { ...DEFAULT_REVIEW_LOOP_CONFIG }, projectOverrides: {} },
    loaded: false,
    states: {},
  })
  useToastStore.setState({ toasts: [] })
})

describe('reviewLoopStore.loadSettings', () => {
  it('stores settings from the IPC and marks the store loaded', async () => {
    const settings = {
      workspace: ws({ maxIterations: 9 }),
      projectOverrides: { p1: { enabled: false } },
    }
    getSettings.mockResolvedValue(settings)
    await useReviewLoopStore.getState().loadSettings()
    expect(useReviewLoopStore.getState().settings).toEqual(settings)
    expect(useReviewLoopStore.getState().loaded).toBe(true)
    expect(toasts()).toHaveLength(0)
  })

  it('shows an error toast with the failure message and still marks loaded', async () => {
    getSettings.mockRejectedValue(new Error('settings file corrupt'))
    await useReviewLoopStore.getState().loadSettings()
    expect(useReviewLoopStore.getState().loaded).toBe(true)
    expect(toasts()).toHaveLength(1)
    expect(toasts()[0]).toMatchObject({ type: 'error', message: 'settings file corrupt' })
  })

  it('falls back to a generic load-failure message when the error has none', async () => {
    getSettings.mockRejectedValue({})
    await useReviewLoopStore.getState().loadSettings()
    expect(toasts()[0]).toMatchObject({
      type: 'error',
      message: 'Failed to load review loop settings',
    })
  })

  it('keeps the existing settings untouched when the load fails', async () => {
    const prior = { workspace: ws({ costCapUsd: 99 }), projectOverrides: {} }
    useReviewLoopStore.setState({ settings: prior })
    getSettings.mockRejectedValue(new Error('nope'))
    await useReviewLoopStore.getState().loadSettings()
    expect(useReviewLoopStore.getState().settings).toEqual(prior)
  })
})

describe('reviewLoopStore.setWorkspaceConfig', () => {
  it('applies the config optimistically before persistence settles', async () => {
    let resolveSave: () => void = () => {}
    setSettings.mockImplementation(() => new Promise<void>((r) => { resolveSave = r }))
    const cfg = ws({ maxIterations: 9, variant: 'pro' })
    const promise = useReviewLoopStore.getState().setWorkspaceConfig(cfg)
    expect(useReviewLoopStore.getState().settings.workspace).toEqual(cfg)
    resolveSave()
    await promise
  })

  it('persists the complete next settings object via the IPC', async () => {
    setSettings.mockResolvedValue(undefined)
    useReviewLoopStore.setState({
      settings: {
        workspace: { ...DEFAULT_REVIEW_LOOP_CONFIG },
        projectOverrides: { p1: { enabled: false } },
      },
    })
    const cfg = ws({ costCapUsd: 12 })
    await useReviewLoopStore.getState().setWorkspaceConfig(cfg)
    expect(setSettings).toHaveBeenCalledWith({
      workspace: cfg,
      projectOverrides: { p1: { enabled: false } },
    })
  })

  it('shows the IPC error message in a toast but keeps the optimistic update', async () => {
    setSettings.mockRejectedValue(new Error('disk full'))
    const cfg = ws({ enabled: false })
    await useReviewLoopStore.getState().setWorkspaceConfig(cfg)
    expect(useReviewLoopStore.getState().settings.workspace).toEqual(cfg)
    expect(toasts()[0]).toMatchObject({ type: 'error', message: 'disk full' })
  })

  it('uses the generic "Failed to save" message for message-less errors', async () => {
    setSettings.mockRejectedValue({})
    await useReviewLoopStore.getState().setWorkspaceConfig(ws())
    expect(toasts()[0]).toMatchObject({ type: 'error', message: 'Failed to save' })
  })
})

describe('reviewLoopStore.setProjectOverride', () => {
  it('adds an override for the project and persists it', async () => {
    setSettings.mockResolvedValue(undefined)
    await useReviewLoopStore.getState().setProjectOverride('p1', { maxIterations: 2 })
    expect(useReviewLoopStore.getState().settings.projectOverrides).toEqual({
      p1: { maxIterations: 2 },
    })
    expect(setSettings).toHaveBeenCalledWith(
      expect.objectContaining({ projectOverrides: { p1: { maxIterations: 2 } } })
    )
  })

  it('removes the override when called with undefined', async () => {
    setSettings.mockResolvedValue(undefined)
    useReviewLoopStore.setState({
      settings: { workspace: ws(), projectOverrides: { p1: { enabled: false } } },
    })
    await useReviewLoopStore.getState().setProjectOverride('p1', undefined)
    expect(useReviewLoopStore.getState().settings.projectOverrides).toEqual({})
  })

  it('removes the override when called with an empty object', async () => {
    setSettings.mockResolvedValue(undefined)
    useReviewLoopStore.setState({
      settings: { workspace: ws(), projectOverrides: { p1: { variant: 'pro' } } },
    })
    await useReviewLoopStore.getState().setProjectOverride('p1', {})
    expect(useReviewLoopStore.getState().settings.projectOverrides).toEqual({})
    expect(setSettings).toHaveBeenCalledWith(
      expect.objectContaining({ projectOverrides: {} })
    )
  })

  it('leaves other projects untouched when adding or removing', async () => {
    setSettings.mockResolvedValue(undefined)
    useReviewLoopStore.setState({
      settings: { workspace: ws(), projectOverrides: { p2: { costCapUsd: 1 } } },
    })
    await useReviewLoopStore.getState().setProjectOverride('p1', { enabled: false })
    expect(useReviewLoopStore.getState().settings.projectOverrides).toEqual({
      p1: { enabled: false },
      p2: { costCapUsd: 1 },
    })
    await useReviewLoopStore.getState().setProjectOverride('p1', undefined)
    expect(useReviewLoopStore.getState().settings.projectOverrides).toEqual({
      p2: { costCapUsd: 1 },
    })
  })

  it('keeps the local override and toasts when persistence fails', async () => {
    setSettings.mockRejectedValue(new Error('save broke'))
    await useReviewLoopStore.getState().setProjectOverride('p1', { enabled: true })
    expect(useReviewLoopStore.getState().settings.projectOverrides.p1).toEqual({ enabled: true })
    expect(toasts()[0]).toMatchObject({ type: 'error', message: 'save broke' })
  })
})

describe('reviewLoopStore.effectiveConfig', () => {
  const workspace = ws({
    enabled: true,
    variant: 'lite',
    maxIterations: 5,
    consecutiveCleanRounds: 2,
    costCapUsd: 5,
  })

  it('returns the workspace config for a null projectId', () => {
    useReviewLoopStore.setState({ settings: { workspace, projectOverrides: { p1: { enabled: false } } } })
    expect(useReviewLoopStore.getState().effectiveConfig(null)).toEqual(workspace)
  })

  it('returns the workspace config when the project has no override', () => {
    useReviewLoopStore.setState({ settings: { workspace, projectOverrides: {} } })
    expect(useReviewLoopStore.getState().effectiveConfig('p-unknown')).toEqual(workspace)
  })

  it('overrides only enabled, keeping every other field from the workspace', () => {
    useReviewLoopStore.setState({
      settings: { workspace, projectOverrides: { p1: { enabled: false } } },
    })
    expect(useReviewLoopStore.getState().effectiveConfig('p1')).toEqual({
      ...workspace,
      enabled: false,
    })
  })

  it('overrides only variant', () => {
    useReviewLoopStore.setState({
      settings: { workspace, projectOverrides: { p1: { variant: 'pro' } } },
    })
    expect(useReviewLoopStore.getState().effectiveConfig('p1')).toEqual({
      ...workspace,
      variant: 'pro',
    })
  })

  it('overrides only maxIterations', () => {
    useReviewLoopStore.setState({
      settings: { workspace, projectOverrides: { p1: { maxIterations: 11 } } },
    })
    expect(useReviewLoopStore.getState().effectiveConfig('p1')).toEqual({
      ...workspace,
      maxIterations: 11,
    })
  })

  it('overrides only consecutiveCleanRounds', () => {
    useReviewLoopStore.setState({
      settings: { workspace, projectOverrides: { p1: { consecutiveCleanRounds: 4 } } },
    })
    expect(useReviewLoopStore.getState().effectiveConfig('p1')).toEqual({
      ...workspace,
      consecutiveCleanRounds: 4,
    })
  })

  it('honours a zero costCapUsd override (nullish merge, not falsy merge)', () => {
    useReviewLoopStore.setState({
      settings: { workspace, projectOverrides: { p1: { costCapUsd: 0 } } },
    })
    expect(useReviewLoopStore.getState().effectiveConfig('p1').costCapUsd).toBe(0)
  })

  it('applies a full override across every field', () => {
    const full = {
      enabled: false,
      variant: 'pro' as const,
      maxIterations: 1,
      consecutiveCleanRounds: 9,
      costCapUsd: 42,
    }
    useReviewLoopStore.setState({ settings: { workspace, projectOverrides: { p1: full } } })
    expect(useReviewLoopStore.getState().effectiveConfig('p1')).toEqual(full)
  })
})

describe('reviewLoopStore.setProjectEnabled', () => {
  it('creates a fresh override carrying just the enabled flag', async () => {
    setSettings.mockResolvedValue(undefined)
    await useReviewLoopStore.getState().setProjectEnabled('p1', false)
    expect(useReviewLoopStore.getState().settings.projectOverrides).toEqual({
      p1: { enabled: false },
    })
  })

  it('merges into an existing override without dropping other fields', async () => {
    setSettings.mockResolvedValue(undefined)
    useReviewLoopStore.setState({
      settings: { workspace: ws(), projectOverrides: { p1: { variant: 'pro', costCapUsd: 3 } } },
    })
    await useReviewLoopStore.getState().setProjectEnabled('p1', true)
    expect(useReviewLoopStore.getState().settings.projectOverrides.p1).toEqual({
      variant: 'pro',
      costCapUsd: 3,
      enabled: true,
    })
  })

  it('persists the toggled settings via the IPC', async () => {
    setSettings.mockResolvedValue(undefined)
    await useReviewLoopStore.getState().setProjectEnabled('p1', true)
    expect(setSettings).toHaveBeenCalledWith(
      expect.objectContaining({ projectOverrides: { p1: { enabled: true } } })
    )
  })

  it('keeps the toggle locally and toasts when persistence fails', async () => {
    setSettings.mockRejectedValue(new Error('readonly fs'))
    await useReviewLoopStore.getState().setProjectEnabled('p1', false)
    expect(useReviewLoopStore.getState().settings.projectOverrides.p1).toEqual({ enabled: false })
    expect(toasts()[0]).toMatchObject({ type: 'error', message: 'readonly fs' })
  })
})

describe('reviewLoopStore.start', () => {
  it('short-circuits with an info toast when the workspace disables the loop', async () => {
    useReviewLoopStore.setState({
      settings: { workspace: ws({ enabled: false }), projectOverrides: {} },
    })
    await useReviewLoopStore.getState().start(startArgs)
    expect(start).not.toHaveBeenCalled()
    expect(toasts()[0]).toMatchObject({
      type: 'info',
      message: 'Review loop is disabled for this project',
    })
  })

  it('short-circuits when a project override disables an otherwise enabled loop', async () => {
    useReviewLoopStore.setState({
      settings: {
        workspace: ws({ enabled: true }),
        projectOverrides: { p1: { enabled: false } },
      },
    })
    await useReviewLoopStore.getState().start(startArgs)
    expect(start).not.toHaveBeenCalled()
    expect(toasts()).toHaveLength(1)
  })

  it('starts when a project override enables a workspace-disabled loop', async () => {
    useReviewLoopStore.setState({
      settings: {
        workspace: ws({ enabled: false }),
        projectOverrides: { p1: { enabled: true } },
      },
    })
    start.mockResolvedValue(undefined)
    await useReviewLoopStore.getState().start(startArgs)
    expect(start).toHaveBeenCalledTimes(1)
    expect(toasts()).toHaveLength(0)
  })

  it('passes the effective config and session details to the IPC', async () => {
    useReviewLoopStore.setState({
      settings: {
        workspace: ws({ maxIterations: 3 }),
        projectOverrides: { p1: { costCapUsd: 7 } },
      },
    })
    start.mockResolvedValue(undefined)
    await useReviewLoopStore.getState().start({ ...startArgs, prNumber: 42 })
    expect(start).toHaveBeenCalledWith({
      sessionId: 's1',
      worktreePath: '/wt/s1',
      branch: 'feat/x',
      baseBranch: 'main',
      config: ws({ maxIterations: 3, costCapUsd: 7 }),
      prNumber: 42,
    })
  })

  it('passes prNumber through as undefined when not supplied', async () => {
    start.mockResolvedValue(undefined)
    await useReviewLoopStore.getState().start(startArgs)
    expect(start.mock.calls[0][0].prNumber).toBeUndefined()
  })

  it('surfaces a start failure message as an error toast', async () => {
    start.mockRejectedValue(new Error('worktree busy'))
    await useReviewLoopStore.getState().start(startArgs)
    expect(toasts()[0]).toMatchObject({ type: 'error', message: 'worktree busy' })
  })

  it('uses the generic start-failure message for message-less errors', async () => {
    start.mockRejectedValue({})
    await useReviewLoopStore.getState().start(startArgs)
    expect(toasts()[0]).toMatchObject({ type: 'error', message: 'Failed to start review loop' })
  })
})

describe('reviewLoopStore.cancel', () => {
  it('cancels via the IPC without toasting on success', async () => {
    cancel.mockResolvedValue(undefined)
    await useReviewLoopStore.getState().cancel('s1')
    expect(cancel).toHaveBeenCalledWith('s1')
    expect(toasts()).toHaveLength(0)
  })

  it('surfaces cancel failures as error toasts', async () => {
    cancel.mockRejectedValue(new Error('not running'))
    await useReviewLoopStore.getState().cancel('s1')
    expect(toasts()[0]).toMatchObject({ type: 'error', message: 'not running' })
  })

  it('falls back to the generic cancel-failure message', async () => {
    cancel.mockRejectedValue({})
    await useReviewLoopStore.getState().cancel('s1')
    expect(toasts()[0]).toMatchObject({ type: 'error', message: 'Failed to cancel review loop' })
  })
})

describe('reviewLoopStore.refreshState', () => {
  it('stores the fetched state under its session id', async () => {
    const s = loopState('s1', { iteration: 3 })
    getState.mockResolvedValue(s)
    await useReviewLoopStore.getState().refreshState('s1')
    expect(getState).toHaveBeenCalledWith('s1')
    expect(useReviewLoopStore.getState().states.s1).toEqual(s)
  })

  it('leaves states untouched when the IPC returns null', async () => {
    useReviewLoopStore.setState({ states: { s2: loopState('s2') } })
    getState.mockResolvedValue(null)
    await useReviewLoopStore.getState().refreshState('s1')
    expect(Object.keys(useReviewLoopStore.getState().states)).toEqual(['s2'])
  })

  it('swallows IPC errors silently without toasting', async () => {
    getState.mockRejectedValue(new Error('gone'))
    await useReviewLoopStore.getState().refreshState('s1')
    expect(toasts()).toHaveLength(0)
    expect(useReviewLoopStore.getState().states).toEqual({})
  })
})

describe('reviewLoopStore.applyState', () => {
  it('keys the state by its sessionId', () => {
    const s = loopState('s9')
    useReviewLoopStore.getState().applyState(s)
    expect(useReviewLoopStore.getState().states).toEqual({ s9: s })
  })

  it('preserves states for other sessions', () => {
    const a = loopState('a')
    const b = loopState('b')
    useReviewLoopStore.getState().applyState(a)
    useReviewLoopStore.getState().applyState(b)
    expect(useReviewLoopStore.getState().states).toEqual({ a, b })
  })

  it('replaces an earlier state for the same session', () => {
    useReviewLoopStore.getState().applyState(loopState('s1', { iteration: 1 }))
    useReviewLoopStore.getState().applyState(loopState('s1', { iteration: 2, status: 'done' as any }))
    expect(useReviewLoopStore.getState().states.s1.iteration).toBe(2)
    expect(Object.keys(useReviewLoopStore.getState().states)).toHaveLength(1)
  })
})
