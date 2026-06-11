import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getSharedPermissions,
  mergePermissions,
  seedPermissions,
  setWindow,
  startWatching,
  stopAllWatching,
  stopWatching,
  updateSharedPermissions,
} from '../../../src/main/services/permission-sync.service'
import { IPC } from '../../../src/shared/constants'

let tmpRoot: string
let repo: string
let wt1: string
let wt2: string

async function writeSettings(dir: string, settings: Record<string, unknown>): Promise<void> {
  await mkdir(join(dir, '.claude'), { recursive: true })
  await writeFile(join(dir, '.claude', 'settings.local.json'), JSON.stringify(settings, null, 2))
}

async function readSettings(dir: string): Promise<Record<string, any>> {
  const raw = await readFile(join(dir, '.claude', 'settings.local.json'), 'utf-8')
  return JSON.parse(raw)
}

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'cc-perm-test-'))
  repo = join(tmpRoot, 'repo')
  wt1 = join(tmpRoot, 'wt1')
  wt2 = join(tmpRoot, 'wt2')
  await mkdir(repo, { recursive: true })
  await mkdir(wt1, { recursive: true })
  await mkdir(wt2, { recursive: true })
})

afterEach(async () => {
  stopAllWatching()
  setWindow(null as never)
  await rm(tmpRoot, { recursive: true, force: true })
})

describe('permission-sync mergePermissions', () => {
  it('unions allow and deny lists', () => {
    const merged = mergePermissions(
      { allow: ['a'], deny: ['x'] },
      { allow: ['b'], deny: ['y'] }
    )
    expect(merged).toEqual({ allow: ['a', 'b'], deny: ['x', 'y'] })
  })

  it('dedupes entries present on both sides', () => {
    const merged = mergePermissions(
      { allow: ['a', 'b'], deny: [] },
      { allow: ['b', 'c'], deny: [] }
    )
    expect(merged.allow).toEqual(['a', 'b', 'c'])
  })

  it('deny wins over allow for conflicting entries', () => {
    const merged = mergePermissions(
      { allow: ['Bash(rm:*)', 'Bash(ls:*)'], deny: [] },
      { allow: [], deny: ['Bash(rm:*)'] }
    )
    expect(merged.allow).toEqual(['Bash(ls:*)'])
    expect(merged.deny).toEqual(['Bash(rm:*)'])
  })

  it('sorts both output lists', () => {
    const merged = mergePermissions(
      { allow: ['z', 'm'], deny: ['q'] },
      { allow: ['a'], deny: ['b'] }
    )
    expect(merged.allow).toEqual(['a', 'm', 'z'])
    expect(merged.deny).toEqual(['b', 'q'])
  })

  it('handles empty inputs', () => {
    expect(mergePermissions({ allow: [], deny: [] }, { allow: [], deny: [] })).toEqual({
      allow: [],
      deny: [],
    })
  })
})

describe('permission-sync seedPermissions', () => {
  it('is a no-op when the main repo has no canonical permissions', () => {
    seedPermissions(repo, wt1)
    expect(existsSync(join(wt1, '.claude', 'settings.local.json'))).toBe(false)
  })

  it('copies canonical permissions into a fresh worktree', async () => {
    await writeSettings(repo, { permissions: { allow: ['Bash(npm test:*)'], deny: ['Read(.env)'] } })
    seedPermissions(repo, wt1)
    const settings = await readSettings(wt1)
    expect(settings.permissions).toEqual({
      allow: ['Bash(npm test:*)'],
      deny: ['Read(.env)'],
    })
  })

  it('merges canonical permissions with pre-existing worktree permissions', async () => {
    await writeSettings(repo, { permissions: { allow: ['shared'], deny: [] } })
    await writeSettings(wt1, { permissions: { allow: ['local-only'], deny: [] } })
    seedPermissions(repo, wt1)
    const settings = await readSettings(wt1)
    expect(settings.permissions.allow).toEqual(['local-only', 'shared'])
  })

  it('preserves unrelated settings keys in the worktree file', async () => {
    await writeSettings(repo, { permissions: { allow: ['a'], deny: [] } })
    await writeSettings(wt1, { hooks: { Stop: [] }, permissions: { allow: [], deny: [] } })
    seedPermissions(repo, wt1)
    const settings = await readSettings(wt1)
    expect(settings.hooks).toEqual({ Stop: [] })
    expect(settings.permissions.allow).toEqual(['a'])
  })
})

describe('permission-sync getSharedPermissions', () => {
  it('returns empty lists when nothing has been stored', () => {
    expect(getSharedPermissions(repo)).toEqual({ allow: [], deny: [] })
  })

  it('reads the canonical store from the main repo settings', async () => {
    await writeSettings(repo, { permissions: { allow: ['x'], deny: ['y'] } })
    expect(getSharedPermissions(repo)).toEqual({ allow: ['x'], deny: ['y'] })
  })

  it('filters non-string entries out of malformed permission arrays', async () => {
    await writeSettings(repo, { permissions: { allow: ['ok', 42, null], deny: [{}] } })
    expect(getSharedPermissions(repo)).toEqual({ allow: ['ok'], deny: [] })
  })
})

describe('permission-sync updateSharedPermissions', () => {
  it('persists to the canonical store', async () => {
    updateSharedPermissions(repo, { allow: ['n1'], deny: ['n2'] })
    expect(getSharedPermissions(repo)).toEqual({ allow: ['n1'], deny: ['n2'] })
  })

  it('replaces (not merges) permissions in every active worktree — the UI is the authority', async () => {
    await writeSettings(wt1, { permissions: { allow: ['stale-entry'], deny: [] } })
    startWatching(repo, wt1)
    startWatching(repo, wt2)

    updateSharedPermissions(repo, { allow: ['fresh'], deny: [] })

    const s1 = await readSettings(wt1)
    const s2 = await readSettings(wt2)
    expect(s1.permissions).toEqual({ allow: ['fresh'], deny: [] })
    expect(s2.permissions).toEqual({ allow: ['fresh'], deny: [] })
  })

  it('does not touch worktrees that are not registered as active', async () => {
    startWatching(repo, wt1)
    updateSharedPermissions(repo, { allow: ['only-active'], deny: [] })
    expect(existsSync(join(wt2, '.claude', 'settings.local.json'))).toBe(false)
  })

  it('emits PERMISSIONS_CHANGED with the repo path and new permissions', () => {
    const sent: Array<{ channel: string; args: unknown[] }> = []
    setWindow({
      isDestroyed: () => false,
      webContents: { send: (channel: string, ...args: unknown[]) => sent.push({ channel, args }) },
    } as never)

    updateSharedPermissions(repo, { allow: ['a'], deny: [] })

    const evt = sent.find((m) => m.channel === IPC.PERMISSIONS_CHANGED)
    expect(evt?.args[0]).toBe(repo)
    expect(evt?.args[1]).toEqual({ allow: ['a'], deny: [] })
  })

  it('preserves hooks and other keys in worktree settings files when propagating', async () => {
    await writeSettings(wt1, {
      hooks: { Stop: [{ matcher: '' }] },
      permissions: { allow: [], deny: [] },
    })
    startWatching(repo, wt1)
    updateSharedPermissions(repo, { allow: ['p'], deny: [] })
    const settings = await readSettings(wt1)
    expect(settings.hooks).toEqual({ Stop: [{ matcher: '' }] })
    expect(settings.permissions.allow).toEqual(['p'])
  })
})

describe('permission-sync watching lifecycle', () => {
  it('startWatching creates the .claude dir so the watcher has something to attach to', () => {
    startWatching(repo, wt1)
    expect(existsSync(join(wt1, '.claude'))).toBe(true)
  })

  it('stopWatching does a final sync of worktree permissions back to canonical', async () => {
    startWatching(repo, wt1)
    await writeSettings(wt1, { permissions: { allow: ['from-worktree'], deny: [] } })
    stopWatching(wt1)
    expect(getSharedPermissions(repo).allow).toContain('from-worktree')
  })

  it('after stopWatching, shared updates no longer propagate to that worktree', async () => {
    startWatching(repo, wt1)
    stopWatching(wt1)
    updateSharedPermissions(repo, { allow: ['late'], deny: [] })
    const settings = await readSettings(wt1).catch(() => null)
    // The worktree file either doesn't exist or doesn't contain the late update.
    if (settings) {
      expect(settings.permissions?.allow ?? []).not.toContain('late')
    } else {
      expect(settings).toBeNull()
    }
  })

  it('stopAllWatching is idempotent and clears every registration', () => {
    startWatching(repo, wt1)
    startWatching(repo, wt2)
    stopAllWatching()
    expect(() => stopAllWatching()).not.toThrow()
    // No active worktrees → propagation writes nothing.
    updateSharedPermissions(repo, { allow: ['after-stop'], deny: [] })
    expect(existsSync(join(wt1, '.claude', 'settings.local.json'))).toBe(false)
  })
})
