import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import * as sandboxer from '../../../src/main/services/sandboxer.service'
import type { SandboxInfo } from '../../../src/shared/types'

// Real git for the config plumbing; a scripted fake for the sandboxer CLI so
// the teardown logic can be driven through every outcome without Docker.
interface Call {
  args: string[]
  cwd?: string
}
let calls: Call[]
let fleet: SandboxInfo[]
let failDown: Set<string>
let lsFails: string | null

function installRunner() {
  sandboxer.setRunnerForTests(async (cmd, args, opts) => {
    if (cmd === 'git') return execFileSync('git', args, { cwd: opts?.cwd, encoding: 'utf8', stdio: 'pipe' })
    calls.push({ args, cwd: opts?.cwd })
    const [verb, slug, , project] = args
    switch (verb) {
      case 'version':
        return JSON.stringify({ version: '0.1.0' })
      case 'ls':
        if (lsFails) throw new Error(lsFails)
        return JSON.stringify(fleet)
      case 'status':
        return JSON.stringify({ urls: { app: `https://${slug}--app--${project}.sbx.localhost` } })
      case 'down':
        if (failDown.has(slug)) throw new Error('could not load config')
        fleet = fleet.filter((s) => !(s.slug === slug && s.project === project))
        return JSON.stringify({ removed: true })
      case 'gc':
        // gc reaps every sandbox whose worktree is gone.
        fleet = fleet.filter((s) => existsSync(s.worktree))
        return JSON.stringify({ reap: [] })
      default:
        return '{}'
    }
  })
}

function sb(slug: string, worktree: string, project = 'acme'): SandboxInfo {
  return { project, slug, branch: `session/${slug}`, worktree, state: 'running', container: `sandboxer-${project}-${slug}` }
}

let dir: string
let repo: string
let worktree: string

function git(cwd: string, ...args: string[]) {
  execFileSync('git', args, { cwd, stdio: 'pipe' })
}

beforeEach(async () => {
  calls = []
  fleet = []
  failDown = new Set()
  lsFails = null
  installRunner()
  dir = await realpath(await mkdtemp(join(tmpdir(), 'sandboxer-test-')))
  repo = join(dir, 'repo')
  await mkdir(repo)
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'user.email', 't@example.com')
  git(repo, 'config', 'user.name', 'T')
  await writeFile(join(repo, 'README.md'), 'hi\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  worktree = join(dir, '.codecrucible-worktrees', 'repo', 'feat')
  git(repo, 'worktree', 'add', '-q', '-b', 'session/feat', worktree)
})

afterEach(async () => {
  sandboxer.setRunnerForTests()
  await rm(dir, { recursive: true, force: true })
})

describe('resolveConfigPath', () => {
  it('defaults to sandboxer.yaml at the repo root', () => {
    expect(sandboxer.resolveConfigPath('/r')).toBe('/r/sandboxer.yaml')
    expect(sandboxer.resolveConfigPath('/r', '  ')).toBe('/r/sandboxer.yaml')
  })
  it('resolves relative paths against the repo and keeps absolute ones', () => {
    expect(sandboxer.resolveConfigPath('/r', 'ops/sandboxer.yaml')).toBe('/r/ops/sandboxer.yaml')
    expect(sandboxer.resolveConfigPath('/r', '/etc/sb.yaml')).toBe('/etc/sb.yaml')
  })
})

describe('checkConfig', () => {
  it('reports a locally excluded config as ignored', async () => {
    await writeFile(join(repo, 'sandboxer.yaml'), 'project: acme\n')
    await writeFile(join(repo, '.git', 'info', 'exclude'), '/sandboxer.yaml\n')
    const check = await sandboxer.checkConfig(repo)
    expect(check).toMatchObject({ exists: true, gitState: 'ignored', cliVersion: '0.1.0' })
  })
  it('reports a committed config as tracked, and a missing one as not found', async () => {
    expect((await sandboxer.checkConfig(repo)).exists).toBe(false)
    await writeFile(join(repo, 'sandboxer.yaml'), 'project: acme\n')
    git(repo, 'add', 'sandboxer.yaml')
    git(repo, 'commit', '-q', '-m', 'cfg')
    expect((await sandboxer.checkConfig(repo)).gitState).toBe('tracked')
  })
})

describe('prepareWorktree', () => {
  it('copies an ignored root config into the worktree, where it stays ignored', async () => {
    await writeFile(join(repo, 'sandboxer.yaml'), 'project: acme\n')
    await writeFile(join(repo, '.git', 'info', 'exclude'), '/sandboxer.yaml\n')
    const result = await sandboxer.prepareWorktree(repo, worktree)
    expect(result.copied).toBe(true)
    expect(await readFile(join(worktree, 'sandboxer.yaml'), 'utf8')).toBe('project: acme\n')
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: worktree, encoding: 'utf8' })).toBe('')
  })

  it('adds an exclude entry when the config is not ignored yet, only once', async () => {
    const cfg = join(dir, 'elsewhere.yaml')
    await writeFile(cfg, 'project: acme\n')
    await sandboxer.prepareWorktree(repo, worktree, cfg)
    await sandboxer.prepareWorktree(repo, worktree, cfg)
    const exclude = await readFile(join(repo, '.git', 'info', 'exclude'), 'utf8')
    expect(exclude.match(/^\/sandboxer\.yaml$/gm)).toHaveLength(1)
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: worktree, encoding: 'utf8' })).toBe('')
  })

  it('refreshes the copy so edits to the source reach the next up', async () => {
    await writeFile(join(repo, 'sandboxer.yaml'), 'project: acme\n')
    await sandboxer.prepareWorktree(repo, worktree)
    await writeFile(join(repo, 'sandboxer.yaml'), 'project: acme2\n')
    await sandboxer.prepareWorktree(repo, worktree)
    expect(await readFile(join(worktree, 'sandboxer.yaml'), 'utf8')).toBe('project: acme2\n')
  })

  it('leaves a worktree that tracks its own config alone', async () => {
    await writeFile(join(worktree, 'sandboxer.yaml'), 'project: own\n')
    git(worktree, 'add', 'sandboxer.yaml')
    git(worktree, 'commit', '-q', '-m', 'own cfg')
    await writeFile(join(repo, 'sandboxer.yaml'), 'project: root\n')
    const result = await sandboxer.prepareWorktree(repo, worktree, join(repo, 'sandboxer.yaml'))
    expect(result.copied).toBe(false)
    expect(await readFile(join(worktree, 'sandboxer.yaml'), 'utf8')).toBe('project: own\n')
  })

  it('throws a clear error when there is no config', async () => {
    await expect(sandboxer.prepareWorktree(repo, worktree)).rejects.toThrow(/No Sandboxer config/)
  })
})

describe('status', () => {
  it('returns only this worktree’s sandboxes, with their URLs', async () => {
    fleet = [sb('feat', worktree), sb('other', join(dir, 'other'))]
    const result = await sandboxer.status(worktree)
    expect(result.map((s) => s.slug)).toEqual(['feat'])
    expect(result[0].urls?.app).toBe('https://feat--app--acme.sbx.localhost')
  })
})

describe('teardownForWorktree', () => {
  it('downs every sandbox built from the worktree, from inside it, and nothing else', async () => {
    fleet = [sb('feat', worktree), sb('feat-api', worktree, 'acme-api'), sb('other', join(dir, 'other'))]
    const report = await sandboxer.teardownForWorktree(worktree)
    expect(report).toEqual({ removed: ['acme/feat', 'acme-api/feat-api'], failed: [] })
    expect(fleet.map((s) => s.slug)).toEqual(['other'])
    const downs = calls.filter((c) => c.args[0] === 'down')
    expect(downs.every((c) => c.cwd === worktree)).toBe(true)
    expect(downs.every((c) => c.args.includes('--json'))).toBe(true)
  })

  it('reports failures instead of throwing', async () => {
    fleet = [sb('feat', worktree)]
    failDown.add('feat')
    const report = await sandboxer.teardownForWorktree(worktree)
    expect(report.removed).toEqual([])
    expect(report.failed[0]).toMatch(/^acme\/feat: could not load config/)
  })

  it('is skipped, not thrown, when sandboxer cannot be asked', async () => {
    lsFails = 'Cannot connect to the Docker daemon'
    const report = await sandboxer.teardownForWorktree(worktree)
    expect(report.skipped).toMatch(/Docker daemon/)
  })
})

describe('reapAfterRemoval', () => {
  it('does nothing — not even gc — when the sandbox is already gone', async () => {
    fleet = [sb('other', join(dir, 'other'))]
    expect(await sandboxer.reapAfterRemoval(worktree)).toEqual([])
    expect(calls.some((c) => c.args[0] === 'gc')).toBe(false)
  })

  it('reaps a sandbox whose down failed once the worktree is gone', async () => {
    fleet = [sb('feat', worktree)]
    await rm(worktree, { recursive: true, force: true })
    expect(await sandboxer.reapAfterRemoval(worktree)).toEqual([])
    expect(calls.some((c) => c.args[0] === 'gc')).toBe(true)
    expect(fleet).toEqual([])
  })
})

describe('reapOrphanedSessionSandboxes', () => {
  it('runs gc only when one of our session worktrees has vanished', async () => {
    fleet = [sb('live', worktree), sb('theirs', join(dir, 'not-ours-gone'))]
    expect(await sandboxer.reapOrphanedSessionSandboxes()).toEqual([])
    expect(calls.some((c) => c.args[0] === 'gc')).toBe(false)

    const gone = join(dir, '.codecrucible-worktrees', 'repo', 'gone')
    fleet.push(sb('gone', gone))
    expect(await sandboxer.reapOrphanedSessionSandboxes()).toEqual(['acme/gone'])
    expect(calls.some((c) => c.args[0] === 'gc')).toBe(true)
  })
})
