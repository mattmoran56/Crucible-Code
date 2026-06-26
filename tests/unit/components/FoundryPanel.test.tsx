import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { FoundryPanel } from '../../../src/renderer/components/foundry/FoundryPanel'
import { useFoundryStore } from '../../../src/renderer/stores/foundryStore'
import { useProjectStore } from '../../../src/renderer/stores/projectStore'
import type {
  FoundryConfig,
  FoundryPipeline,
  FoundryRuntimeState,
  Project,
} from '../../../src/shared/types'

const PROJECT_ID = 'proj-1'

const project: Project = { id: PROJECT_ID, name: 'CodeCrucible', path: '/tmp/cc' } as Project

function makeConfig(over: Partial<FoundryConfig> = {}): FoundryConfig {
  return {
    id: 'fnd-1',
    name: 'Simulation attempt tracking',
    projectId: PROJECT_ID,
    enabled: true,
    taskSetFilters: [],
    completionTransition: { property: 'Status', fromValue: 'In review', toValue: 'Testing' },
    completedStatuses: ['Done'],
    pickupUpdates: [],
    readyForReviewUpdates: [],
    implementCommandTemplate: 'x',
    readyForReviewCommandTemplate: 'y',
    branchNameTemplate: 'foundry/{{taskTitleSlug}}',
    baseBranch: 'main',
    maxConcurrentTasks: 3,
    workerPermissionMode: 'default',
    triggerOnCompletedStatusEnter: true,
    ...over,
  } as FoundryConfig
}

function makePipeline(over: Partial<FoundryPipeline> = {}): FoundryPipeline {
  return {
    id: 'pipe-1',
    foundryId: 'fnd-1',
    page: { id: 'p1', url: 'https://n/p1', title: 'Ticket one', rawProperties: {} },
    phase: 'implementing',
    sessionId: 's1',
    branch: 'feat/one',
    worktreePath: '/tmp/wt',
    baseBranch: 'main',
    startedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    log: [],
    ...over,
  } as FoundryPipeline
}

function makeState(foundryId: string, over: Partial<FoundryRuntimeState> = {}): FoundryRuntimeState {
  return {
    foundryId,
    pageStatusSnapshot: {},
    documentedHashes: {},
    pipelines: [],
    passes: [],
    ...over,
  } as FoundryRuntimeState
}

const runNow = vi.fn()
const setPaused = vi.fn()

/** Flush pending microtasks + timers inside act() so the on-mount reload and
 *  store actions (which call the stubbed window.api then reload) settle without
 *  "not wrapped in act" warnings. */
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

/** Seed the stores + a window.api stub, then render the panel and let the
 *  on-mount reload settle. */
async function setup(configs: FoundryConfig[], states: Record<string, FoundryRuntimeState>) {
  ;(window as any).api = {
    foundry: {
      list: async () => configs,
      getState: async (id: string) => states[id] ?? null,
      runNow: async (id: string) => runNow(id),
      setPaused: async (id: string, paused: boolean) => setPaused(id, paused),
      pipelineAction: async () => {},
      publishPRs: async () => {},
      resetState: async () => ({ ok: true }),
    },
    terminal: {
      write: async () => {},
      onData: () => () => {},
      onExit: () => () => {},
    },
  }

  useProjectStore.setState({ projects: [project], activeProjectId: PROJECT_ID })
  useFoundryStore.setState({ configs, states })

  const view = render(<FoundryPanel />)
  // FoundryPanel calls reload() in an effect; let it resolve.
  await flush()
  return view
}

beforeEach(() => {
  runNow.mockReset()
  setPaused.mockReset()
})

afterEach(() => {
  useFoundryStore.setState({ configs: [], states: {} })
  useProjectStore.setState({ projects: [], activeProjectId: null })
})

describe('FoundryPanel — empty + single foundry', () => {
  it('shows the no-foundry empty state when none are configured', async () => {
    await setup([], {})
    expect(await screen.findByText('No foundry configured')).toBeInTheDocument()
  })

  it('renders the selected foundry name and project', async () => {
    const cfg = makeConfig()
    await setup([cfg], { [cfg.id]: makeState(cfg.id) })
    expect(await screen.findByText('Simulation attempt tracking')).toBeInTheDocument()
    expect(screen.getByText('CodeCrucible')).toBeInTheDocument()
  })

  it('does not render the switcher when there is only one foundry', async () => {
    const cfg = makeConfig()
    await setup([cfg], { [cfg.id]: makeState(cfg.id) })
    expect(screen.queryByTitle('Switch foundry')).not.toBeInTheDocument()
  })

  it('shows the off state when the foundry is disabled', async () => {
    const cfg = makeConfig({ enabled: false })
    await setup([cfg], { [cfg.id]: makeState(cfg.id) })
    expect(await screen.findByText('Foundry is off')).toBeInTheDocument()
    // "Off" status label in the header.
    expect(screen.getByText('Off')).toBeInTheDocument()
  })

  it('renders active pipelines with their phase label', async () => {
    const cfg = makeConfig()
    const state = makeState(cfg.id, { pipelines: [makePipeline({ phase: 'reviewing' })] })
    await setup([cfg], { [cfg.id]: state })
    expect(await screen.findByText('Ticket one')).toBeInTheDocument()
    expect(screen.getByText('Reviewing')).toBeInTheDocument()
    expect(screen.getByText('Active (1)')).toBeInTheDocument()
  })
})

describe('FoundryPanel — status derivation', () => {
  it('reports "Needs attention" when a pipeline is flagged', async () => {
    const cfg = makeConfig()
    const state = makeState(cfg.id, {
      pipelines: [makePipeline({ attention: { reason: 'stuck', since: '2026-01-01T00:00:00.000Z' } })],
    })
    await setup([cfg], { [cfg.id]: state })
    expect(await screen.findByText('Needs attention')).toBeInTheDocument()
  })

  it('reports "Paused" when paused', async () => {
    const cfg = makeConfig({ paused: true })
    await setup([cfg], { [cfg.id]: makeState(cfg.id) })
    expect(await screen.findByText('Paused')).toBeInTheDocument()
  })

  it('reports "Running" when pipelines are in flight', async () => {
    const cfg = makeConfig()
    const state = makeState(cfg.id, { pipelines: [makePipeline({ phase: 'implementing' })] })
    await setup([cfg], { [cfg.id]: state })
    expect(await screen.findByText('Running')).toBeInTheDocument()
  })

  it('reports "Idle" when enabled with no active pipelines', async () => {
    const cfg = makeConfig()
    await setup([cfg], { [cfg.id]: makeState(cfg.id) })
    expect(await screen.findByText('Idle')).toBeInTheDocument()
  })
})

describe('FoundryPanel — multi-foundry switcher', () => {
  const a = makeConfig({ id: 'a', name: 'Alpha foundry', enabled: false })
  const b = makeConfig({ id: 'b', name: 'Bravo foundry', enabled: true })
  const c = makeConfig({ id: 'c', name: 'Charlie foundry', enabled: true })

  it('defaults the selection to the first enabled foundry', async () => {
    await setup([a, b, c], {
      a: makeState('a'),
      b: makeState('b'),
      c: makeState('c'),
    })
    // Bravo is the first *enabled* one, so it is the trigger label.
    const trigger = await screen.findByTitle('Switch foundry')
    expect(within(trigger).getByText('Bravo foundry')).toBeInTheDocument()
  })

  it('opens the dropdown and lists every foundry with its status', async () => {
    await setup([a, b, c], {
      a: makeState('a'),
      b: makeState('b', { pipelines: [makePipeline({ foundryId: 'b' })] }),
      c: makeState('c'),
    })
    fireEvent.click(await screen.findByTitle('Switch foundry'))

    // Scope assertions to the dropdown menu (the panel header also shows the
    // selected foundry's name + status, so global queries would be ambiguous).
    const menu = (await screen.findByText('Foundries (3)')).parentElement as HTMLElement
    expect(within(menu).getByText('Alpha foundry')).toBeInTheDocument()
    expect(within(menu).getByText('Bravo foundry')).toBeInTheDocument()
    expect(within(menu).getByText('Charlie foundry')).toBeInTheDocument()
    // Per-foundry status labels in the menu.
    expect(within(menu).getByText('Off')).toBeInTheDocument() // Alpha (disabled)
    expect(within(menu).getByText('Running')).toBeInTheDocument() // Bravo (active pipeline)
  })

  it('switches the active foundry when another is picked', async () => {
    await setup([a, b, c], {
      a: makeState('a'),
      b: makeState('b'),
      c: makeState('c'),
    })
    fireEvent.click(await screen.findByTitle('Switch foundry'))
    fireEvent.click(await screen.findByText('Charlie foundry'))

    await waitFor(() => {
      const trigger = screen.getByTitle('Switch foundry')
      expect(within(trigger).getByText('Charlie foundry')).toBeInTheDocument()
    })
    // The menu closed after selection.
    expect(screen.queryByText('Foundries (3)')).not.toBeInTheDocument()
  })

  it('only lists foundries for the active project', async () => {
    const other = makeConfig({ id: 'z', name: 'Other project foundry', projectId: 'proj-2' })
    await setup([b, c, other], {
      b: makeState('b'),
      c: makeState('c'),
      z: makeState('z'),
    })
    fireEvent.click(await screen.findByTitle('Switch foundry'))
    expect(await screen.findByText('Foundries (2)')).toBeInTheDocument()
    expect(screen.queryByText('Other project foundry')).not.toBeInTheDocument()
  })
})

describe('FoundryPanel — actions', () => {
  it('runs a pass when "Run pass" is clicked', async () => {
    const cfg = makeConfig()
    await setup([cfg], { [cfg.id]: makeState(cfg.id) })
    fireEvent.click(await screen.findByText('Run pass'))
    await flush()
    expect(runNow).toHaveBeenCalledWith(cfg.id)
  })

  it('toggles pause when "Pause" is clicked', async () => {
    const cfg = makeConfig({ paused: false })
    await setup([cfg], { [cfg.id]: makeState(cfg.id) })
    fireEvent.click(await screen.findByText('Pause'))
    await flush()
    expect(setPaused).toHaveBeenCalledWith(cfg.id, true)
  })
})
