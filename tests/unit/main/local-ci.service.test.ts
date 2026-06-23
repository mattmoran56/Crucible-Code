import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalPR } from '../../../src/shared/types'

// local-ci uses execFile in child-object form: child.stdout.on('data'), child.on('close').
const ci = vi.hoisted(() => {
  const state = { code: 0, output: 'all good' }
  const invocations: Array<{ cmd: string; args: string[]; opts: any }> = []
  const execFileMock = (cmd: string, args: string[], opts: any) => {
    invocations.push({ cmd, args, opts })
    return {
      stdout: { on: (ev: string, cb: (d: string) => void) => { if (ev === 'data' && state.output) cb(state.output) } },
      stderr: { on: () => {} },
      on: (ev: string, cb: (code: number) => void) => { if (ev === 'close') cb(state.code) },
    }
  }
  return { state, invocations, execFileMock }
})

const fsp = vi.hoisted(() => ({ writes: [] as Array<{ path: string; data: string }> }))

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/ci-test' } }))
vi.mock('node:child_process', () => ({ default: { execFile: ci.execFileMock }, execFile: ci.execFileMock }))
vi.mock('node:fs/promises', () => {
  const m = {
    mkdir: async () => {},
    writeFile: async (path: string, data: string) => { fsp.writes.push({ path, data }) },
  }
  return { ...m, default: m }
})

let mod: typeof import('../../../src/main/services/local-ci.service')

const lpr: LocalPR = {
  id: 'lpr-1', localNumber: 1, projectId: 'p', worktreePath: '/wt',
  title: 'T', body: 'B', branch: 'feat/x', baseBranch: 'main',
  status: 'open', createdAt: 'now', updatedAt: 'now', log: [],
}

beforeEach(async () => {
  ci.state.code = 0
  ci.state.output = 'all good'
  ci.invocations.length = 0
  fsp.writes.length = 0
  vi.resetModules()
  mod = await import('../../../src/main/services/local-ci.service')
})

afterEach(() => vi.clearAllTimers())

describe('local-ci.service', () => {
  it('maps a zero exit code to success and writes the log', async () => {
    const res = await mod.runLocalCI(lpr, { enabled: true, runner: 'act' })
    expect(res.status).toBe('success')
    expect(res.checks[0].conclusion).toBe('success')
    expect(res.checks[0].status).toBe('completed')
    expect(res.runner).toBe('act')
    expect(res.logTailPath).toContain('lpr-1.log')
    expect(fsp.writes[0].data).toBe('all good')
  })

  it('maps a non-zero exit code to failure', async () => {
    ci.state.code = 1
    ci.state.output = 'boom'
    const res = await mod.runLocalCI(lpr, { enabled: true, runner: 'act' })
    expect(res.status).toBe('failure')
    expect(res.checks[0].conclusion).toBe('failure')
  })

  it('runs act with the configured image + workflow filter', async () => {
    await mod.runLocalCI(lpr, { enabled: true, runner: 'act', image: 'my/img:tag', workflowFilter: '.github/workflows/ci.yml' })
    const inv = ci.invocations[0]
    expect(inv.cmd).toBe('act')
    expect(inv.args).toContain('-P')
    expect(inv.args).toContain('ubuntu-latest=my/img:tag')
    expect(inv.args).toContain('-W')
    expect(inv.args).toContain('.github/workflows/ci.yml')
    expect(inv.opts.cwd).toBe('/wt')
  })

  it('honours a full command override', async () => {
    await mod.runLocalCI(lpr, { enabled: true, runner: 'act', command: 'make ci --fast' })
    const inv = ci.invocations[0]
    expect(inv.cmd).toBe('make')
    expect(inv.args).toEqual(['ci', '--fast'])
  })

  it('fails fast when there is no worktree', async () => {
    const res = await mod.runLocalCI({ ...lpr, worktreePath: undefined }, { enabled: true, runner: 'act' })
    expect(res.status).toBe('failure')
    expect(ci.invocations).toHaveLength(0)
  })

  it('ciLogTail returns only the tail', () => {
    const big = 'x'.repeat(5000)
    expect(mod.ciLogTail(big, 100)).toHaveLength(100)
    expect(mod.ciLogTail('short', 100)).toBe('short')
  })
})
