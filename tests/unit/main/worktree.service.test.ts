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

  it('createWorktree without a base branches off the remote default branch tip, not the local checkout', async () => {
    // Simulate a typical user setup: an `origin` remote whose default branch
    // is `main`, but the user is checked out on a feature branch that's
    // behind `main`. Notion-fired sessions pass no base branch, so the
    // worktree should still start from `origin/main`, not the stale local ref.
    const remotePath = join(tmpRoot, 'remote.git')
    await mkdir(remotePath, { recursive: true })
    await simpleGit(remotePath).raw(['init', '--bare'])

    const g = simpleGit(repoPath)
    await g.raw(['remote', 'add', 'origin', remotePath])
    await g.raw(['push', 'origin', 'main:main'])

    // Move the local main forward, then push so origin/main is ahead of what
    // we'll roll the local main back to.
    await writeFile(join(repoPath, 'NEW.md'), 'new on main\n')
    await g.add('NEW.md')
    await g.commit('main moved forward')
    await g.raw(['push', 'origin', 'main'])
    const remoteMainSha = (await g.revparse(['HEAD'])).trim()

    // Roll the local main ref back to its initial commit so it's stale
    // relative to origin/main, then switch to a feature branch off that
    // stale local main. This mimics the real failure: the user's local main
    // hasn't been pulled, and they're sitting on a feature branch that's
    // behind the actual remote default.
    await g.raw(['reset', '--hard', 'HEAD~1'])
    await g.checkoutLocalBranch('feature-a')

    // Mark `main` as the remote's default so getDefaultBranch() can find it.
    await g.raw(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'])

    // No baseBranch passed — mirrors the Notion auto-pickup path.
    const info = await createWorktree(repoPath, 'auto/notion')

    const wtSha = (await simpleGit(info.path).revparse(['HEAD'])).trim()
    expect(wtSha).toBe(remoteMainSha)
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
