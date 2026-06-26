import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalPR } from '../../../src/shared/types'

// ── Mock harness ────────────────────────────────────────────────────────────
// electron-store → in-memory FakeStore; electron app path; and controllable
// local-pr / git / github / claude mocks so the stack logic is deterministic.

const stores: Record<string, Record<string, unknown>> = {}

class FakeStore<T extends Record<string, unknown>> {
  private name: string
  constructor(opts: { name?: string; defaults: T }) {
    this.name = opts.name ?? 'default'
    if (!stores[this.name]) stores[this.name] = JSON.parse(JSON.stringify(opts.defaults))
  }
  get<K extends keyof T>(key: K, defaultValue?: T[K]): T[K] {
    return (stores[this.name][key as string] ?? defaultValue) as T[K]
  }
  set<K extends keyof T>(key: K, value: T[K]): void {
    stores[this.name][key as string] = value
  }
  delete(key: string): void {
    delete stores[this.name][key]
  }
}

vi.mock('electron-store', () => ({ default: FakeStore }))
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/pr-stack-test', isPackaged: false } }))

// In-memory local PR table the service reads/patches through.
const localPRs = vi.hoisted(() => new Map<string, LocalPR>())
vi.mock('../../../src/main/services/local-pr.service', () => ({
  LOCAL_PR_CHANGED: 'local-pr:changed',
  getLocalPR: (id: string) => localPRs.get(id) ?? null,
  patchLocalPR: (id: string, patch: Partial<LocalPR>) => {
    const cur = localPRs.get(id)
    if (!cur) return null
    const next = { ...cur, ...patch }
    localPRs.set(id, next)
    return next
  },
}))

const promoteLocalPR = vi.hoisted(() => vi.fn())
vi.mock('../../../src/main/services/local-pr-promote.service', () => ({ promoteLocalPR }))

const setPRBase = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('../../../src/main/services/github.service', () => ({ setPRBase }))

const gitMock = vi.hoisted(() => ({
  checkoutBranch: vi.fn(async () => ({ stashed: false })),
  fetchAndPull: vi.fn(async () => {}),
  checkMerge: vi.fn(async () => ({ hasConflicts: false })),
  mergeBranch: vi.fn(async () => {}),
  mergeBranchAllowConflict: vi.fn(async () => ({ conflicted: false, unmergedFiles: [] as string[] })),
  listUnmergedFiles: vi.fn(async () => [] as string[]),
  abortMerge: vi.fn(async () => {}),
  pushBranch: vi.fn(async () => {}),
  commitPendingMerge: vi.fn(async () => {}),
}))
vi.mock('../../../src/main/services/git.service', () => gitMock)

const injectAndAwaitResponse = vi.hoisted(() => vi.fn(async () => true))
vi.mock('../../../src/main/services/worker-inject.service', () => ({ injectAndAwaitResponse }))
vi.mock('../../../src/main/services/terminal.service', () => ({ listTerminalsForSession: () => [] }))
const runHeadlessClaude = vi.hoisted(() => vi.fn(async () => ({ ok: true, transcript: [], costUsd: 0, exitCode: 0, signal: null })))
vi.mock('../../../src/main/services/claude-headless.service', () => ({ runHeadlessClaude }))
vi.mock('../../../src/main/services/permission-sync.service', () => ({ seedPermissions: () => {} }))

let svc: typeof import('../../../src/main/services/pr-stack.service')
let bus: import('node:events').EventEmitter

const PROJECT = 'proj-1'
const FOUNDRY = 'fnd-1'

function seedFoundryConfig(stackMode: 'new' | 'existing' | 'none', stackTargetStackId?: string): void {
  stores['foundry-config'] = {
    foundries: [
      { id: FOUNDRY, name: 'My Foundry', projectId: PROJECT, foundryBranch: 'foundry/int', stackMode, stackTargetStackId },
    ],
  }
}

function seedLocalPR(id: string, localNumber: number, branch: string, extra: Partial<LocalPR> = {}): void {
  localPRs.set(id, {
    id,
    localNumber,
    projectId: PROJECT,
    title: `PR ${localNumber}`,
    body: '',
    branch,
    baseBranch: 'main',
    status: 'local',
    createdAt: '',
    updatedAt: '',
    log: [],
    ...extra,
  })
}

beforeEach(async () => {
  for (const k of Object.keys(stores)) delete stores[k]
  localPRs.clear()
  // repo path lookup reads the default (unnamed) config store.
  stores['default'] = { projects: [{ id: PROJECT, repoPath: '/repo' }] }
  promoteLocalPR.mockReset()
  setPRBase.mockReset().mockResolvedValue(undefined)
  Object.values(gitMock).forEach((fn) => fn.mockClear())
  gitMock.checkMerge.mockResolvedValue({ hasConflicts: false })
  gitMock.mergeBranchAllowConflict.mockResolvedValue({ conflicted: false, unmergedFiles: [] })
  gitMock.listUnmergedFiles.mockResolvedValue([])
  gitMock.checkoutBranch.mockResolvedValue({ stashed: false })
  injectAndAwaitResponse.mockReset().mockResolvedValue(true)
  runHeadlessClaude.mockReset().mockResolvedValue({ ok: true, transcript: [], costUsd: 0, exitCode: 0, signal: null })
  vi.resetModules()
  svc = await import('../../../src/main/services/pr-stack.service')
  bus = (await import('../../../src/main/services/event-bus')).eventBus
})

describe('pr-stack.service — CRUD + chain linking', () => {
  it('creates a stack and adds entries bottom-first, linking parentLocalPrId', () => {
    seedLocalPR('a', 1, 'feat/a')
    seedLocalPR('b', 2, 'feat/b')
    const stack = svc.createStack({ projectId: PROJECT, name: 'S1', baseBranch: 'main' })
    svc.addEntry(stack.id, { kind: 'local', localPrId: 'a' })
    const after = svc.addEntry(stack.id, { kind: 'local', localPrId: 'b' })!

    expect(after.entries.map((e) => e.localPrId)).toEqual(['a', 'b'])
    expect(after.entries.map((e) => e.order)).toEqual([0, 1])
    // Bottom targets the stack base; the next links to its predecessor.
    expect(localPRs.get('a')!.parentLocalPrId).toBeUndefined()
    expect(localPRs.get('a')!.baseBranch).toBe('main')
    expect(localPRs.get('b')!.parentLocalPrId).toBe('a')
    expect(after.entries[1].baseBranch).toBe('feat/a')
  })

  it('addEntry is idempotent for the same PR', () => {
    seedLocalPR('a', 1, 'feat/a')
    const stack = svc.createStack({ projectId: PROJECT, name: 'S', baseBranch: 'main' })
    svc.addEntry(stack.id, { kind: 'local', localPrId: 'a' })
    const again = svc.addEntry(stack.id, { kind: 'local', localPrId: 'a' })!
    expect(again.entries).toHaveLength(1)
  })

  it('removeEntry re-links the remaining chain', () => {
    seedLocalPR('a', 1, 'feat/a')
    seedLocalPR('b', 2, 'feat/b')
    seedLocalPR('c', 3, 'feat/c')
    const stack = svc.createStack({ projectId: PROJECT, name: 'S', baseBranch: 'main' })
    for (const id of ['a', 'b', 'c']) svc.addEntry(stack.id, { kind: 'local', localPrId: id })
    const after = svc.removeEntry(stack.id, svc.getStack(stack.id)!.entries[1].id)! // remove 'b'

    expect(after.entries.map((e) => e.localPrId)).toEqual(['a', 'c'])
    expect(localPRs.get('c')!.parentLocalPrId).toBe('a') // c now chains onto a
  })

  it('reorderEntries updates order and parent links', () => {
    seedLocalPR('a', 1, 'feat/a')
    seedLocalPR('b', 2, 'feat/b')
    const stack = svc.createStack({ projectId: PROJECT, name: 'S', baseBranch: 'main' })
    svc.addEntry(stack.id, { kind: 'local', localPrId: 'a' })
    svc.addEntry(stack.id, { kind: 'local', localPrId: 'b' })
    const ids = svc.getStack(stack.id)!.entries.map((e) => e.id)
    const after = svc.reorderEntries(stack.id, [ids[1], ids[0]])! // b now bottom

    expect(after.entries.map((e) => e.localPrId)).toEqual(['b', 'a'])
    expect(localPRs.get('b')!.parentLocalPrId).toBeUndefined()
    expect(localPRs.get('a')!.parentLocalPrId).toBe('b')
  })

  it('mergeStacks appends, relinks, and deletes the source', () => {
    seedLocalPR('a', 1, 'feat/a')
    seedLocalPR('b', 2, 'feat/b')
    const t = svc.createStack({ projectId: PROJECT, name: 'T', baseBranch: 'main' })
    const s = svc.createStack({ projectId: PROJECT, name: 'S', baseBranch: 'main' })
    svc.addEntry(t.id, { kind: 'local', localPrId: 'a' })
    svc.addEntry(s.id, { kind: 'local', localPrId: 'b' })
    const merged = svc.mergeStacks(t.id, s.id)!

    expect(merged.entries.map((e) => e.localPrId)).toEqual(['a', 'b'])
    expect(svc.getStack(s.id)).toBeNull()
    expect(localPRs.get('b')!.parentLocalPrId).toBe('a')
  })
})

describe('pr-stack.service — publish', () => {
  it('promotes un-published local entries in order and skips promoted ones', async () => {
    seedLocalPR('a', 1, 'feat/a', { status: 'open', realPrNumber: 10 }) // already published
    seedLocalPR('b', 2, 'feat/b')
    promoteLocalPR.mockImplementation(async (id: string) => {
      localPRs.set(id, { ...localPRs.get(id)!, status: 'open', realPrNumber: 11 })
      return localPRs.get(id)
    })
    const stack = svc.createStack({ projectId: PROJECT, name: 'S', baseBranch: 'main' })
    svc.addEntry(stack.id, { kind: 'local', localPrId: 'a' })
    svc.addEntry(stack.id, { kind: 'local', localPrId: 'b' })

    await svc.publishStack(stack.id)

    expect(promoteLocalPR).toHaveBeenCalledTimes(1)
    expect(promoteLocalPR).toHaveBeenCalledWith('b', { markReady: true })
    expect(svc.getStack(stack.id)!.publish!.status).toBe('done')
  })

  it('stops with error when a promote fails', async () => {
    seedLocalPR('a', 1, 'feat/a')
    promoteLocalPR.mockResolvedValue({ status: 'error' })
    const stack = svc.createStack({ projectId: PROJECT, name: 'S', baseBranch: 'main' })
    svc.addEntry(stack.id, { kind: 'local', localPrId: 'a' })

    await svc.publishStack(stack.id)
    expect(svc.getStack(stack.id)!.publish!.status).toBe('error')
  })
})

describe('pr-stack.service — foundry stackMode routing', () => {
  it("'new' auto-creates one stack per foundry from completed local PRs", () => {
    seedFoundryConfig('new')
    seedLocalPR('a', 1, 'feat/a', { foundryId: FOUNDRY })
    svc.startPRStackService(null as never)
    bus.emit('local-pr:changed', localPRs.get('a'))

    const stacks = svc.listStacks(PROJECT)
    expect(stacks).toHaveLength(1)
    expect(stacks[0].foundryId).toBe(FOUNDRY)
    expect(stacks[0].entries.map((e) => e.localPrId)).toEqual(['a'])
  })

  it("'none' produces no stack", () => {
    seedFoundryConfig('none')
    seedLocalPR('a', 1, 'feat/a', { foundryId: FOUNDRY })
    svc.startPRStackService(null as never)
    bus.emit('local-pr:changed', localPRs.get('a'))
    expect(svc.listStacks(PROJECT)).toHaveLength(0)
  })

  it("'existing' appends to the configured target stack", () => {
    const target = (() => {
      seedFoundryConfig('new') // create a target stack first via a manual create
      return svc.createStack({ projectId: PROJECT, name: 'Target', baseBranch: 'main' })
    })()
    seedFoundryConfig('existing', target.id)
    seedLocalPR('a', 1, 'feat/a', { foundryId: FOUNDRY })
    svc.startPRStackService(null as never)
    bus.emit('local-pr:changed', localPRs.get('a'))

    expect(svc.getStack(target.id)!.entries.map((e) => e.localPrId)).toEqual(['a'])
    // No extra foundry stack was created.
    expect(svc.listStacks(PROJECT)).toHaveLength(1)
  })
})

describe('pr-stack.service — upward propagation', () => {
  function twoEntryStack() {
    seedLocalPR('a', 1, 'feat/a')
    seedLocalPR('b', 2, 'feat/b')
    const stack = svc.createStack({ projectId: PROJECT, name: 'S', baseBranch: 'main' })
    svc.addEntry(stack.id, { kind: 'local', localPrId: 'a' })
    svc.addEntry(stack.id, { kind: 'local', localPrId: 'b' })
    return svc.getStack(stack.id)!
  }

  it('merges the lower branch into each entry above on a clean merge', async () => {
    const stack = twoEntryStack()
    const bottom = stack.entries[0]
    await svc.propagateUpward(stack.id, bottom.id)

    expect(gitMock.mergeBranch).toHaveBeenCalledWith('/repo', 'feat/a')
    expect(gitMock.pushBranch).toHaveBeenCalled()
    expect(svc.getStack(stack.id)!.propagation!.status).toBe('done')
  })

  it('invokes Claude on conflict, then continues after a clean resolution', async () => {
    const stack = twoEntryStack()
    gitMock.checkMerge.mockResolvedValue({ hasConflicts: true })
    gitMock.mergeBranchAllowConflict.mockResolvedValue({ conflicted: true, unmergedFiles: ['x.ts'] })
    // After the resolver runs, the tree is clean.
    gitMock.listUnmergedFiles.mockResolvedValue([])

    await svc.propagateUpward(stack.id, stack.entries[0].id)

    expect(runHeadlessClaude).toHaveBeenCalledTimes(1) // no live PTY → headless fallback
    expect(gitMock.pushBranch).toHaveBeenCalled()
    expect(svc.getStack(stack.id)!.propagation!.status).toBe('done')
  })

  it('stops the cascade with error when conflicts are not resolved', async () => {
    const stack = twoEntryStack()
    gitMock.checkMerge.mockResolvedValue({ hasConflicts: true })
    gitMock.mergeBranchAllowConflict.mockResolvedValue({ conflicted: true, unmergedFiles: ['x.ts'] })
    runHeadlessClaude.mockResolvedValue({ ok: false, transcript: [], costUsd: 0, exitCode: 1, signal: null })
    gitMock.listUnmergedFiles.mockResolvedValue(['x.ts']) // still conflicted

    await svc.propagateUpward(stack.id, stack.entries[0].id)

    expect(gitMock.abortMerge).toHaveBeenCalled()
    expect(gitMock.pushBranch).not.toHaveBeenCalled()
    expect(svc.getStack(stack.id)!.propagation!.status).toBe('error')
  })
})
