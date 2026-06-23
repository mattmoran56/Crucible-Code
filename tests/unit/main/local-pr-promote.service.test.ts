import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Shared FakeStore so promote + local-pr.service see the same records.
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

const gh = vi.hoisted(() => ({
  createDraftPR: vi.fn(async (_wt: string, opts: { title: string; body: string; base: string; head: string }) => ({
    number: 77,
    url: `https://github.com/o/r/pull/77`,
    isDraft: true,
    _opts: opts,
  })),
  markPRReady: vi.fn(async () => {}),
  findPRForBranch: vi.fn(async () => null),
}))

const git = vi.hoisted(() => {
  const calls: Array<{ cmd: string; args: string[] }> = []
  const execFileMock = (
    cmd: string,
    args: string[],
    opts: unknown,
    cb?: (e: unknown, r?: { stdout: string; stderr: string }) => void
  ) => {
    calls.push({ cmd, args })
    const callback = (typeof opts === 'function' ? opts : cb) as (e: unknown, r?: { stdout: string; stderr: string }) => void
    callback(null, { stdout: '', stderr: '' })
  }
  return { calls, execFileMock }
})

vi.mock('electron-store', () => ({ default: FakeStore }))
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/promote-test', isPackaged: false } }))
vi.mock('../../../src/main/store-path', () => ({ getStorePath: () => '/tmp/promote-test' }))
vi.mock('../../../src/main/services/github.service', () => gh)
vi.mock('../../../src/main/services/git.service', () => ({ pushBranch: vi.fn(async () => {}), getDefaultBranch: vi.fn(async () => 'main') }))
vi.mock('node:child_process', () => ({ default: { execFile: git.execFileMock }, execFile: git.execFileMock }))
vi.mock('node:fs', () => ({ default: { existsSync: () => true }, existsSync: () => true }))

let localPr: typeof import('../../../src/main/services/local-pr.service')
let promote: typeof import('../../../src/main/services/local-pr-promote.service')

const PROJECT = 'proj-1'

async function seed(fields: Record<string, any> = {}) {
  return localPr.captureLocalPR({
    contextId: 'ctx-1',
    projectId: PROJECT,
    worktreePath: '/wt',
    action: 'create',
    fields: { title: 'My change', body: 'The body', base: 'main', head: 'feat/x', sha: 's1', ...fields },
  })
}

beforeEach(async () => {
  for (const k of Object.keys(stores)) delete stores[k]
  gh.createDraftPR.mockClear()
  gh.markPRReady.mockClear()
  git.calls.length = 0
  vi.resetModules()
  localPr = await import('../../../src/main/services/local-pr.service')
  promote = await import('../../../src/main/services/local-pr-promote.service')
})

afterEach(() => vi.clearAllTimers())

describe('local-pr-promote', () => {
  it('opens a draft PR from the stored body and flips status to open', async () => {
    await seed()
    const id = localPr.listLocalPRs(PROJECT)[0].id
    const result = await promote.promoteLocalPR(id)

    expect(gh.createDraftPR).toHaveBeenCalledTimes(1)
    const [, opts] = gh.createDraftPR.mock.calls[0]
    expect(opts).toMatchObject({ title: 'My change', body: 'The body', base: 'main', head: 'feat/x' })
    expect(result?.status).toBe('open')
    expect(result?.realPrNumber).toBe(77)
    expect(result?.realPrUrl).toContain('/pull/77')
  })

  it('pushes the branch before opening the PR', async () => {
    await seed()
    const id = localPr.listLocalPRs(PROJECT)[0].id
    await promote.promoteLocalPR(id)
    const push = git.calls.find((c) => c.cmd === 'git' && c.args[0] === 'push')
    expect(push?.args).toEqual(['push', 'origin', 'feat/x'])
  })

  it('resolves the base from a chained parent local PR', async () => {
    // parent
    await seed({ head: 'feat/parent' })
    const parent = localPr.listLocalPRs(PROJECT)[0]
    // child chained onto parent
    localPr.setCaptureContext('ctx-2', null)
    await localPr.captureLocalPR({ contextId: 'ctx-2', projectId: PROJECT, worktreePath: '/wt2', action: 'create', fields: { title: 'Child', body: 'b', base: 'main', head: 'feat/child' } })
    const child = localPr.listLocalPRs(PROJECT).find((p) => p.branch === 'feat/child')!
    localPr.patchLocalPR(child.id, { parentLocalPrId: parent.id })

    await promote.promoteLocalPR(child.id)
    const [, opts] = gh.createDraftPR.mock.calls[0]
    expect(opts.base).toBe('feat/parent') // parent's branch, not 'main'
  })

  it('marks the PR ready when asked', async () => {
    await seed()
    const id = localPr.listLocalPRs(PROJECT)[0].id
    await promote.promoteLocalPR(id, { markReady: true })
    expect(gh.markPRReady).toHaveBeenCalledWith('/wt', 77)
  })

  it('marks the PR ready when the worker marked the local one ready', async () => {
    await seed()
    const id = localPr.listLocalPRs(PROJECT)[0].id
    localPr.patchLocalPR(id, { readyForReview: true })
    await promote.promoteLocalPR(id) // no markReady opt
    expect(gh.markPRReady).toHaveBeenCalledTimes(1)
  })

  it('does not mark ready by default', async () => {
    await seed()
    const id = localPr.listLocalPRs(PROJECT)[0].id
    await promote.promoteLocalPR(id)
    expect(gh.markPRReady).not.toHaveBeenCalled()
  })

  it('records an error + attention when createDraftPR throws', async () => {
    gh.createDraftPR.mockRejectedValueOnce(new Error('gh exploded'))
    await seed()
    const id = localPr.listLocalPRs(PROJECT)[0].id
    const result = await promote.promoteLocalPR(id)
    expect(result?.status).toBe('error')
    expect(result?.attention?.reason).toContain('gh exploded')
  })

  it('returns null for an unknown id and is a no-op on merged PRs', async () => {
    expect(await promote.promoteLocalPR('nope')).toBeNull()
    await seed()
    const id = localPr.listLocalPRs(PROJECT)[0].id
    localPr.patchLocalPR(id, { status: 'merged' })
    const result = await promote.promoteLocalPR(id)
    expect(result?.status).toBe('merged')
    expect(gh.createDraftPR).not.toHaveBeenCalled()
  })
})
