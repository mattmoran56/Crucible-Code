import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import simpleGit from 'simple-git'
import {
  createWorktree,
  listWorktrees,
  removeWorktree,
} from '../../../src/main/services/worktree.service'

let tmpRoot: string
let repoPath: string

async function initRepo(path: string) {
  const g = simpleGit(path)
  await g.init()
  await g.addConfig('user.email', 'test@example.com')
  await g.addConfig('user.name', 'Test')
  await g.addConfig('commit.gpgsign', 'false')
  // Some hosts default init.defaultBranch elsewhere; force `main` so tests are
  // deterministic regardless of the user's git config.
  await g.raw(['symbolic-ref', 'HEAD', 'refs/heads/main'])
  await writeFile(join(path, 'README.md'), 'hello\n')
  await g.add('README.md')
  await g.commit('initial')
}

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'cc-wt-test-'))
  repoPath = join(tmpRoot, 'repo')
  await mkdir(repoPath, { recursive: true })
  await initRepo(repoPath)
})

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true })
})

describe('worktree.service', () => {
  it('createWorktree creates a session/<name> branch and worktree dir', async () => {
    const info = await createWorktree(repoPath, 'feat/x', 'main')
    expect(info.branch).toBe('session/feat/x')
    expect(info.path.endsWith('feat/x')).toBe(true)

    const list = await listWorktrees(repoPath)
    const found = list.find((w) => w.branch === 'session/feat/x')
    expect(found).toBeDefined()
    // macOS resolves /var to /private/var, so compare via realpath.
    expect(await realpath(found!.path)).toBe(await realpath(info.path))
  })

  it('removeWorktree removes the worktree and deletes its session/* branch', async () => {
    const info = await createWorktree(repoPath, 'feat/y', 'main')
    await removeWorktree(repoPath, info.path)

    const list = await listWorktrees(repoPath)
    expect(list.find((w) => w.branch === 'session/feat/y')).toBeUndefined()

    const branches = await simpleGit(repoPath).branch()
    expect(Object.keys(branches.branches)).not.toContain('session/feat/y')
  })

  it('listWorktrees prunes stale entries from a deleted worktree directory', async () => {
    const info = await createWorktree(repoPath, 'feat/stale', 'main')

    // Simulate the user deleting the worktree dir outside of git (or moving
    // the parent repo) — git keeps a stale admin entry under .git/worktrees/
    // that keeps the branch "in use" until pruned.
    await rm(info.path, { recursive: true, force: true })

    const list = await listWorktrees(repoPath)
    // After prune, the stale entry is gone from `worktree list`.
    expect(list.find((w) => w.path === info.path)).toBeUndefined()

    // And the branch can now be deleted by other tools (e.g. GitHub Desktop)
    // because the worktree no longer claims it.
    await expect(
      simpleGit(repoPath).raw(['branch', '-D', 'session/feat/stale'])
    ).resolves.toBeDefined()
  })

  it('removeWorktree succeeds even when the worktree directory is already gone', async () => {
    const info = await createWorktree(repoPath, 'feat/gone', 'main')
    await rm(info.path, { recursive: true, force: true })

    await expect(removeWorktree(repoPath, info.path)).resolves.toBeUndefined()

    const branches = await simpleGit(repoPath).branch()
    expect(Object.keys(branches.branches)).not.toContain('session/feat/gone')
  })

  it('removeWorktree leaves non-session branches alone', async () => {
    // Create a regular branch and attach a worktree to it manually.
    const g = simpleGit(repoPath)
    await g.raw(['branch', 'keepme', 'main'])
    const wtPath = join(tmpRoot, 'extwt')
    await g.raw(['worktree', 'add', wtPath, 'keepme'])

    await removeWorktree(repoPath, wtPath)

    const branches = await g.branch()
    expect(Object.keys(branches.branches)).toContain('keepme')
  })
})
