import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ── Mock harness ────────────────────────────────────────────────────────────
// electron-store → in-memory FakeStore; electron app path; git.service; and a
// controllable execFile so the service's git probes return deterministic data.

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
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/local-pr-test', isPackaged: false },
}))
vi.mock('../../../src/main/services/git.service', () => ({
  pushBranch: vi.fn(async () => {}),
  getDefaultBranch: vi.fn(async () => 'main'),
}))

// Controllable git via execFile. Keyed on the git subcommand.
const git = vi.hoisted(() => {
  const impl = vi.fn((_cmd: string, args: string[]): string => {
    if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'feat/widget'
    if (args[0] === 'rev-parse') return 'abc123sha'
    if (args[0] === 'log') return 'Add the widget\n\nLonger body here.'
    return ''
  })
  const execFileMock = (
    cmd: string,
    args: string[],
    opts: unknown,
    cb?: (e: unknown, r?: { stdout: string; stderr: string }) => void
  ) => {
    const callback = (typeof opts === 'function' ? opts : cb) as (
      e: unknown,
      r?: { stdout: string; stderr: string }
    ) => void
    try {
      callback(null, { stdout: impl(cmd, args), stderr: '' })
    } catch (err) {
      callback(err)
    }
  }
  return { impl, execFileMock }
})
vi.mock('node:child_process', () => ({ default: { execFile: git.execFileMock }, execFile: git.execFileMock }))

// Dynamic import (after mocks are registered + the FakeStore class exists) with
// per-test module reset so the service's lazy store + capture registry are fresh.
let svc: typeof import('../../../src/main/services/local-pr.service')

const PROJECT = 'proj-1'

beforeEach(async () => {
  for (const k of Object.keys(stores)) delete stores[k]
  git.impl.mockClear()
  git.impl.mockImplementation((_cmd: string, args: string[]) => {
    if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'feat/widget'
    if (args[0] === 'rev-parse') return 'abc123sha'
    if (args[0] === 'log') return 'Add the widget\n\nLonger body here.'
    return ''
  })
  vi.resetModules()
  svc = await import('../../../src/main/services/local-pr.service')
})

afterEach(() => {
  vi.clearAllTimers()
})

describe('local-pr.service — capture registry', () => {
  it('records and clears capture intent + metadata', () => {
    expect(svc.shouldCaptureContext('ctx-1')).toBe(false)
    svc.setCaptureContext('ctx-1', { foundryId: 'f1', pipelineId: 'p1', order: 3 })
    expect(svc.shouldCaptureContext('ctx-1')).toBe(true)
    expect(svc.getCaptureContext('ctx-1')).toMatchObject({ foundryId: 'f1', order: 3 })
    svc.setCaptureContext('ctx-1', null)
    expect(svc.shouldCaptureContext('ctx-1')).toBe(false)
  })
})

describe('local-pr.service — captureLocalPR(create)', () => {
  it('creates a local PR record and returns a fake LOCAL url', async () => {
    const res = await svc.captureLocalPR({
      contextId: 'ctx-1',
      projectId: PROJECT,
      worktreePath: '/wt',
      action: 'create',
      fields: { title: 'My PR', body: 'Body', base: 'main', head: 'feat/widget', sha: 'sha1', draft: true },
    })
    expect(res.number).toBe(1)
    expect(res.url).toBe('https://github.com/local/local/pull/1')

    const list = svc.listLocalPRs(PROJECT)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({
      title: 'My PR',
      body: 'Body',
      branch: 'feat/widget',
      baseBranch: 'main',
      status: 'local',
      localNumber: 1,
      sessionId: 'ctx-1',
    })
  })

  it('falls back to git-derived branch/base/title when fields are blank', async () => {
    await svc.captureLocalPR({
      contextId: 'ctx-1',
      projectId: PROJECT,
      worktreePath: '/wt',
      action: 'create',
      fields: { title: '', body: '' },
    })
    const pr = svc.listLocalPRs(PROJECT)[0]
    expect(pr.branch).toBe('feat/widget') // from rev-parse --abbrev-ref
    expect(pr.baseBranch).toBe('main') // from getDefaultBranch mock
    expect(pr.title).toBe('Widget') // branchToTitle(feat/widget)
  })

  it('links Foundry metadata from the capture context', async () => {
    svc.setCaptureContext('ctx-1', { foundryId: 'f1', pipelineId: 'pipe-9', order: 2 })
    await svc.captureLocalPR({
      contextId: 'ctx-1',
      projectId: PROJECT,
      worktreePath: '/wt',
      action: 'create',
      fields: { title: 'T', body: 'B', head: 'feat/widget' },
    })
    const pr = svc.getLocalPRForPipeline('pipe-9')
    expect(pr).toBeTruthy()
    expect(pr).toMatchObject({ foundryId: 'f1', order: 2, pipelineId: 'pipe-9' })
  })

  it('is idempotent — re-running create for the same branch updates in place', async () => {
    const a = await svc.captureLocalPR({ contextId: 'ctx-1', projectId: PROJECT, worktreePath: '/wt', action: 'create', fields: { title: 'First', body: 'B1', head: 'feat/widget' } })
    const b = await svc.captureLocalPR({ contextId: 'ctx-1', projectId: PROJECT, worktreePath: '/wt', action: 'create', fields: { title: 'Second', body: 'B2', head: 'feat/widget' } })
    expect(a.number).toBe(b.number)
    const list = svc.listLocalPRs(PROJECT)
    expect(list).toHaveLength(1)
    expect(list[0].title).toBe('Second')
  })
})

describe('local-pr.service — captureLocalPR(edit/ready/view)', () => {
  async function seed() {
    return svc.captureLocalPR({ contextId: 'ctx-1', projectId: PROJECT, worktreePath: '/wt', action: 'create', fields: { title: 'Orig', body: 'Orig body', head: 'feat/widget' } })
  }

  it('edit updates title/body only when provided', async () => {
    await seed()
    await svc.captureLocalPR({ contextId: 'ctx-1', projectId: PROJECT, worktreePath: '/wt', action: 'edit', fields: { title: 'New title', body: 'ignored', haveTitle: true, haveBody: false } })
    const pr = svc.listLocalPRs(PROJECT)[0]
    expect(pr.title).toBe('New title')
    expect(pr.body).toBe('Orig body') // haveBody false → unchanged
  })

  it('ready sets the readyForReview flag', async () => {
    await seed()
    await svc.captureLocalPR({ contextId: 'ctx-1', projectId: PROJECT, worktreePath: '/wt', action: 'ready', fields: { title: '', body: '' } })
    expect(svc.listLocalPRs(PROJECT)[0].readyForReview).toBe(true)
  })

  it('view returns a JSON object for --json fields', async () => {
    await seed()
    const res = await svc.captureLocalPR({ contextId: 'ctx-1', projectId: PROJECT, worktreePath: '/wt', action: 'view', fields: { title: '', body: '', json: 'number,title,isDraft' } })
    expect(res.view_b64).toBeTruthy()
    const decoded = JSON.parse(Buffer.from(res.view_b64!, 'base64').toString('utf8'))
    expect(decoded).toEqual({ number: 1, title: 'Orig', isDraft: true })
  })

  it('view returns a text summary when no --json', async () => {
    await seed()
    const res = await svc.captureLocalPR({ contextId: 'ctx-1', projectId: PROJECT, worktreePath: '/wt', action: 'view', fields: { title: '', body: '' } })
    const decoded = Buffer.from(res.view_b64!, 'base64').toString('utf8')
    expect(decoded).toContain('Orig')
    expect(decoded).toContain('feat/widget')
  })

  it('view marks isDraft false once readyForReview is set', async () => {
    await seed()
    await svc.captureLocalPR({ contextId: 'ctx-1', projectId: PROJECT, worktreePath: '/wt', action: 'ready', fields: { title: '', body: '' } })
    const res = await svc.captureLocalPR({ contextId: 'ctx-1', projectId: PROJECT, worktreePath: '/wt', action: 'view', fields: { title: '', body: '', json: 'isDraft' } })
    const decoded = JSON.parse(Buffer.from(res.view_b64!, 'base64').toString('utf8'))
    expect(decoded.isDraft).toBe(false)
  })

  it('edit with no existing record falls through to create', async () => {
    await svc.captureLocalPR({ contextId: 'ctx-1', projectId: PROJECT, worktreePath: '/wt', action: 'edit', fields: { title: 'Made', body: 'B', haveTitle: true, haveBody: true, head: 'feat/widget' } })
    expect(svc.listLocalPRs(PROJECT)).toHaveLength(1)
    expect(svc.listLocalPRs(PROJECT)[0].title).toBe('Made')
  })
})

describe('local-pr.service — createFromSession / update / discard', () => {
  it('snapshots a session into a local PR, deriving title/body from the last commit', async () => {
    const pr = await svc.createFromSession({ projectId: PROJECT, sessionId: 's1', worktreePath: '/wt', branch: 'feat/widget' })
    expect(pr.title).toBe('Add the widget')
    expect(pr.body).toBe('Longer body here.')
    expect(pr.branch).toBe('feat/widget')
    expect(pr.status).toBe('local')
    expect(pr.sessionId).toBe('s1')
  })

  it('honours explicit title/base overrides', async () => {
    const pr = await svc.createFromSession({ projectId: PROJECT, sessionId: 's1', worktreePath: '/wt', branch: 'feat/widget', title: 'Custom', baseBranch: 'develop' })
    expect(pr.title).toBe('Custom')
    expect(pr.baseBranch).toBe('develop')
  })

  it('updateLocalPR patches editable fields', async () => {
    const pr = await svc.createFromSession({ projectId: PROJECT, sessionId: 's1', worktreePath: '/wt', branch: 'feat/widget' })
    const updated = svc.updateLocalPR(pr.id, { title: 'Renamed', body: 'New body' })
    expect(updated?.title).toBe('Renamed')
    expect(updated?.body).toBe('New body')
  })

  it('discardLocalPR removes the record', async () => {
    const pr = await svc.createFromSession({ projectId: PROJECT, sessionId: 's1', worktreePath: '/wt', branch: 'feat/widget' })
    svc.discardLocalPR(pr.id)
    expect(svc.listLocalPRs(PROJECT)).toHaveLength(0)
  })
})

describe('local-pr.service — reads', () => {
  it('getLocalPR finds across projects; localNumber is monotonic', async () => {
    const a = await svc.captureLocalPR({ contextId: 'ctx-1', projectId: 'pa', worktreePath: '/a', action: 'create', fields: { title: 'A', body: '', head: 'feat/a' } })
    svc.setCaptureContext('ctx-2', null)
    const b = await svc.captureLocalPR({ contextId: 'ctx-2', projectId: 'pb', worktreePath: '/b', action: 'create', fields: { title: 'B', body: '', head: 'feat/b' } })
    expect(b.number).toBe(a.number! + 1)
    const got = svc.getLocalPR(svc.listLocalPRs('pb')[0].id)
    expect(got?.title).toBe('B')
  })
})
