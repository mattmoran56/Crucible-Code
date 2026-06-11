import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import simpleGit from 'simple-git'
import {
  checkMerge,
  checkoutBranch,
  discardFile,
  fetchAndPull,
  getCommitFullDiff,
  getCommitStatuses,
  getCompareCommits,
  getCompareDiff,
  getCompareFileDiff,
  getCompareFiles,
  getDefaultBranch,
  getDiff,
  getFileDiff,
  getLog,
  getRemoteUrl,
  getStatus,
  getWorkingChangedFiles,
  getWorkingDiff,
  getWorkingFileDiff,
  getWorkingFilesPR,
  listBranches,
  mergeBranch,
  pushBranch,
  remoteUrlToGitHub,
  restoreWorktreeBranch,
  showFile,
  showFileBase64,
  stageFile,
  stashFile,
  unstageFile,
} from '../../../src/main/services/git.service'

let tmpRoot: string
let repo: string

async function initRepo(path: string): Promise<void> {
  const g = simpleGit(path)
  await g.init()
  await g.addConfig('user.email', 'test@example.com')
  await g.addConfig('user.name', 'Test')
  await g.addConfig('commit.gpgsign', 'false')
  // Force `main` so tests don't depend on the host's init.defaultBranch.
  await g.raw(['symbolic-ref', 'HEAD', 'refs/heads/main'])
  await writeFile(join(path, 'README.md'), 'hello\n')
  await g.add('README.md')
  await g.commit('initial')
}

/** Create a bare origin, push main, and wire it up as `origin`. */
async function addOrigin(): Promise<string> {
  const remotePath = join(tmpRoot, 'origin.git')
  await mkdir(remotePath, { recursive: true })
  await simpleGit(remotePath).raw(['init', '--bare'])
  const g = simpleGit(repo)
  await g.raw(['remote', 'add', 'origin', remotePath])
  await g.raw(['push', 'origin', 'main:main'])
  return remotePath
}

async function commitFile(name: string, content: string, message: string): Promise<string> {
  const g = simpleGit(repo)
  await writeFile(join(repo, name), content)
  await g.add(name)
  await g.commit(message)
  return (await g.revparse(['HEAD'])).trim()
}

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'cc-git-test-'))
  repo = join(tmpRoot, 'repo')
  await mkdir(repo, { recursive: true })
  await initRepo(repo)
})

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true })
})

describe('git.service remoteUrlToGitHub (pure)', () => {
  it('converts an https remote with .git suffix', () => {
    expect(remoteUrlToGitHub('https://github.com/owner/repo.git')).toBe(
      'https://github.com/owner/repo'
    )
  })

  it('converts an https remote without .git suffix', () => {
    expect(remoteUrlToGitHub('https://github.com/owner/repo')).toBe(
      'https://github.com/owner/repo'
    )
  })

  it('converts an ssh remote with .git suffix', () => {
    expect(remoteUrlToGitHub('git@github.com:owner/repo.git')).toBe(
      'https://github.com/owner/repo'
    )
  })

  it('converts an ssh remote without .git suffix', () => {
    expect(remoteUrlToGitHub('git@github.com:owner/repo')).toBe('https://github.com/owner/repo')
  })

  it('returns null for non-GitHub remotes', () => {
    expect(remoteUrlToGitHub('https://gitlab.com/owner/repo.git')).toBeNull()
    expect(remoteUrlToGitHub('/local/path/repo.git')).toBeNull()
  })
})

describe('git.service status + log', () => {
  it('getStatus reports a clean tree right after the initial commit', async () => {
    const status = await getStatus(repo)
    expect(status.files).toHaveLength(0)
    expect(status.current).toBe('main')
  })

  it('getStatus lists modified files', async () => {
    await writeFile(join(repo, 'README.md'), 'changed\n')
    const status = await getStatus(repo)
    expect(status.modified).toContain('README.md')
  })

  it('getLog returns commits newest-first with mapped fields', async () => {
    await commitFile('a.txt', 'a\n', 'second commit')
    const log = await getLog(repo)
    expect(log).toHaveLength(2)
    expect(log[0].message).toBe('second commit')
    expect(log[1].message).toBe('initial')
    expect(log[0].author).toBe('Test')
    expect(log[0].hash).toMatch(/^[0-9a-f]{40}$/)
  })

  it('getLog honors maxCount', async () => {
    await commitFile('a.txt', 'a\n', 'second commit')
    const log = await getLog(repo, 1)
    expect(log).toHaveLength(1)
    expect(log[0].message).toBe('second commit')
  })
})

describe('git.service commit diffs', () => {
  it('getDiff diffs a normal commit against its parent with line counts', async () => {
    const g = simpleGit(repo)
    await writeFile(join(repo, 'README.md'), 'goodbye\n')
    await g.add('README.md')
    await g.commit('change readme')
    const sha = (await g.revparse(['HEAD'])).trim()

    const files = await getDiff(repo, sha)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatchObject({
      filePath: 'README.md',
      insertions: 1,
      deletions: 1,
    })
  })

  it('getDiff rejects for a root commit (hardcoded empty-tree hash is not the canonical one)', async () => {
    // The service diffs root commits against 4b825dc642cb6eb9a060e54bf899d69f82cf7202,
    // but git's canonical SHA-1 empty tree is 4b825dc642cb6eb9a060e54bf8d69288fbee4904,
    // so the lookup fails with "bad object" on every machine.
    const g = simpleGit(repo)
    const rootSha = (await g.revparse(['HEAD'])).trim()
    await expect(getDiff(repo, rootSha)).rejects.toThrow(/bad object/)
  })

  it('getFileDiff returns the patch for one file of a normal commit', async () => {
    const g = simpleGit(repo)
    await writeFile(join(repo, 'README.md'), 'goodbye\n')
    await g.add('README.md')
    await g.commit('change readme')
    const sha = (await g.revparse(['HEAD'])).trim()

    const patch = await getFileDiff(repo, sha, 'README.md')
    expect(patch).toContain('-hello')
    expect(patch).toContain('+goodbye')
  })

  it('getFileDiff rejects for a root commit (same non-canonical empty-tree hash)', async () => {
    const sha = (await simpleGit(repo).revparse(['HEAD'])).trim()
    await expect(getFileDiff(repo, sha, 'README.md')).rejects.toThrow(/bad object/)
  })

  it('getCommitFullDiff rejects for a root commit (same non-canonical empty-tree hash)', async () => {
    const sha = (await simpleGit(repo).revparse(['HEAD'])).trim()
    await expect(getCommitFullDiff(repo, sha)).rejects.toThrow(/bad object/)
  })
})

describe('git.service branches + default branch', () => {
  it('getDefaultBranch prefers origin/HEAD over the current checkout', async () => {
    await addOrigin()
    const g = simpleGit(repo)
    await g.raw(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'])
    await g.checkoutLocalBranch('feature-x')
    expect(await getDefaultBranch(repo)).toBe('main')
  })

  it('getDefaultBranch falls back to the current branch without a remote', async () => {
    await simpleGit(repo).checkoutLocalBranch('feature-y')
    expect(await getDefaultBranch(repo)).toBe('feature-y')
  })

  it("getDefaultBranch falls back to 'main' for a non-repo directory", async () => {
    const plain = join(tmpRoot, 'not-a-repo')
    await mkdir(plain, { recursive: true })
    expect(await getDefaultBranch(plain)).toBe('main')
  })

  it('listBranches merges local and remote branches, deduped and sorted, without HEAD', async () => {
    await addOrigin()
    const g = simpleGit(repo)
    await g.raw(['fetch', 'origin'])
    await g.raw(['branch', 'b-local', 'main'])
    await g.raw(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'])

    const branches = await listBranches(repo)
    expect(branches).toEqual(['b-local', 'main'])
  })

  it('getRemoteUrl returns the origin URL when configured', async () => {
    const remotePath = await addOrigin()
    expect(await getRemoteUrl(repo)).toBe(remotePath)
  })

  it('getRemoteUrl returns null when there is no origin', async () => {
    expect(await getRemoteUrl(repo)).toBeNull()
  })
})

describe('git.service merge checks', () => {
  it('checkMerge reports no conflicts for an additive branch', async () => {
    const g = simpleGit(repo)
    await g.checkoutLocalBranch('additive')
    await commitFile('new.txt', 'new\n', 'add file')
    await g.checkout('main')
    expect(await checkMerge(repo, 'additive')).toEqual({ hasConflicts: false })
  })

  it('checkMerge detects conflicting edits to the same line', async () => {
    const g = simpleGit(repo)
    await g.checkoutLocalBranch('conflicting')
    await commitFile('README.md', 'world\n', 'branch edit')
    await g.checkout('main')
    await commitFile('README.md', 'mars\n', 'main edit')
    expect(await checkMerge(repo, 'conflicting')).toEqual({ hasConflicts: true })
  })

  it('checkMerge treats an unknown branch as conflicting (safe default)', async () => {
    expect(await checkMerge(repo, 'does-not-exist')).toEqual({ hasConflicts: true })
  })

  it('mergeBranch merges a branch into the current checkout', async () => {
    const g = simpleGit(repo)
    await g.checkoutLocalBranch('feat')
    await commitFile('feat.txt', 'feature\n', 'feature commit')
    await g.checkout('main')
    await mergeBranch(repo, 'feat')
    expect(existsSync(join(repo, 'feat.txt'))).toBe(true)
  })
})

describe('git.service checkoutBranch', () => {
  it('checks out an existing local branch on a clean tree without stashing', async () => {
    const g = simpleGit(repo)
    await g.raw(['branch', 'side', 'main'])
    const result = await checkoutBranch(repo, 'side')
    expect(result).toEqual({ stashed: false })
    expect((await g.status()).current).toBe('side')
  })

  it('auto-stashes dirty changes in stash mode and records it in the result', async () => {
    const g = simpleGit(repo)
    await g.raw(['branch', 'side', 'main'])
    await writeFile(join(repo, 'README.md'), 'dirty\n')

    const result = await checkoutBranch(repo, 'side', 'stash')
    expect(result.stashed).toBe(true)
    expect((await g.status()).current).toBe('side')
    const stashes = await g.raw(['stash', 'list'])
    expect(stashes).toContain('codecrucible: auto-stash before switching to side')
  })

  it('carry mode keeps the dirty changes in the working tree across the switch', async () => {
    const g = simpleGit(repo)
    await g.raw(['branch', 'side', 'main'])
    await writeFile(join(repo, 'extra.txt'), 'carried\n')

    const result = await checkoutBranch(repo, 'side', 'carry')
    expect(result.stashed).toBe(false)
    expect((await g.status()).current).toBe('side')
    expect(existsSync(join(repo, 'extra.txt'))).toBe(true)
  })

  it('detaches a worktree that holds the branch, then checks it out locally', async () => {
    const g = simpleGit(repo)
    await g.raw(['branch', 'wt-branch', 'main'])
    const wtPath = join(tmpRoot, 'wt')
    await g.raw(['worktree', 'add', wtPath, 'wt-branch'])

    const result = await checkoutBranch(repo, 'wt-branch')
    expect(result.error).toBeUndefined()
    expect(result.detachedWorktree).toBe(wtPath)
    expect((await g.status()).current).toBe('wt-branch')
    // The worktree should now be in detached-HEAD state.
    const wtStatus = await simpleGit(wtPath).status()
    expect(wtStatus.current).not.toBe('wt-branch')
  })

  it('returns an error for a branch that exists nowhere', async () => {
    const result = await checkoutBranch(repo, 'ghost-branch')
    expect(result.error).toBeDefined()
    expect((await simpleGit(repo).status()).current).toBe('main')
  })

  it('restoreWorktreeBranch re-attaches a detached worktree to its branch', async () => {
    const g = simpleGit(repo)
    await g.raw(['branch', 'wt-restore', 'main'])
    const wtPath = join(tmpRoot, 'wt-r')
    await g.raw(['worktree', 'add', wtPath, 'wt-restore'])
    await simpleGit(wtPath).raw(['checkout', '--detach'])

    await restoreWorktreeBranch(wtPath, 'wt-restore')
    expect((await simpleGit(wtPath).status()).current).toBe('wt-restore')
  })
})

describe('git.service push/fetch', () => {
  it('pushBranch pushes the current branch to origin with upstream tracking', async () => {
    const remotePath = await addOrigin()
    const localSha = await commitFile('p.txt', 'p\n', 'to push')

    await pushBranch(repo)

    const remoteSha = (await simpleGit(remotePath).revparse(['main'])).trim()
    expect(remoteSha).toBe(localSha)
    const upstream = (await simpleGit(repo).raw(['config', 'branch.main.remote'])).trim()
    expect(upstream).toBe('origin')
  })

  it('fetchAndPull fast-forwards the local ref to origin', async () => {
    await addOrigin()
    const g = simpleGit(repo)
    const aheadSha = await commitFile('f.txt', 'f\n', 'ahead commit')
    await g.raw(['push', 'origin', 'main'])
    // Roll local main back so origin is ahead.
    await g.raw(['reset', '--hard', 'HEAD~1'])
    expect((await g.revparse(['main'])).trim()).not.toBe(aheadSha)

    await fetchAndPull(repo, 'main')
    expect((await g.revparse(['main'])).trim()).toBe(aheadSha)
  })
})

describe('git.service working-tree diffs', () => {
  it('getWorkingFileDiff combines staged and unstaged hunks for a tracked file', async () => {
    const g = simpleGit(repo)
    await writeFile(join(repo, 'README.md'), 'staged-line\n')
    await g.add('README.md')
    await writeFile(join(repo, 'README.md'), 'unstaged-line\n')

    const patch = await getWorkingFileDiff(repo, 'README.md')
    expect(patch).toContain('+staged-line')
    expect(patch).toContain('+unstaged-line')
  })

  it('getWorkingFileDiff synthesizes an addition diff for an untracked file', async () => {
    await writeFile(join(repo, 'untracked.txt'), 'one\ntwo\n')
    const patch = await getWorkingFileDiff(repo, 'untracked.txt')
    expect(patch).toContain('--- /dev/null')
    expect(patch).toContain('+++ b/untracked.txt')
    expect(patch).toContain('@@ -0,0 +1,2 @@')
    expect(patch).toContain('+one')
    expect(patch).toContain('+two')
  })

  it('getWorkingFileDiff returns an empty string for a missing file', async () => {
    expect(await getWorkingFileDiff(repo, 'no-such-file.txt')).toBe('')
  })

  it('getWorkingDiff includes staged, unstaged and untracked changes together', async () => {
    const g = simpleGit(repo)
    await commitFile('b.txt', 'b-original\n', 'add b')
    await writeFile(join(repo, 'README.md'), 'staged-change\n')
    await g.add('README.md')
    await writeFile(join(repo, 'b.txt'), 'b-unstaged\n')
    await writeFile(join(repo, 'c.txt'), 'c-untracked\n')

    const diff = await getWorkingDiff(repo)
    expect(diff).toContain('+staged-change')
    expect(diff).toContain('+b-unstaged')
    expect(diff).toContain('+c-untracked')
    expect(diff).toContain('+++ b/c.txt')
  })

  it('getWorkingDiff renders a binary stub for untracked binary files', async () => {
    await writeFile(join(repo, 'bin.dat'), Buffer.from([1, 0, 2, 3]))
    const diff = await getWorkingDiff(repo)
    expect(diff).toContain('Binary files /dev/null and b/bin.dat differ')
  })

  it('getWorkingDiff emits an empty hunk for an empty untracked file', async () => {
    await writeFile(join(repo, 'empty.txt'), '')
    const diff = await getWorkingDiff(repo)
    expect(diff).toContain('+++ b/empty.txt')
    expect(diff).toContain('@@ -0,0 +0,0 @@')
  })

  it('getWorkingDiff marks a missing trailing newline on untracked files', async () => {
    await writeFile(join(repo, 'nonewline.txt'), 'no-newline-here')
    const diff = await getWorkingDiff(repo)
    expect(diff).toContain('+no-newline-here')
    expect(diff).toContain('\\ No newline at end of file')
  })

  it('getWorkingFilesPR dedupes a staged new file that appears in multiple status buckets', async () => {
    const g = simpleGit(repo)
    await writeFile(join(repo, 'README.md'), 'mod\n')
    await writeFile(join(repo, 'staged-new.txt'), 's\n')
    await g.add('staged-new.txt')
    await writeFile(join(repo, 'untracked.txt'), 'u\n')

    const files = await getWorkingFilesPR(repo)
    const paths = files.map((f) => f.path)
    expect(new Set(paths).size).toBe(paths.length)
    expect(paths).toContain('README.md')
    expect(paths).toContain('staged-new.txt')
    expect(paths).toContain('untracked.txt')
    expect(files.find((f) => f.path === 'untracked.txt')?.status).toBe('added')
    expect(files.find((f) => f.path === 'README.md')?.status).toBe('modified')
  })

  it('getWorkingChangedFiles maps modified, untracked, and deleted statuses', async () => {
    const g = simpleGit(repo)
    await commitFile('todelete.txt', 'x\n', 'add deletable')
    await writeFile(join(repo, 'README.md'), 'mod\n')
    await writeFile(join(repo, 'new.txt'), 'n\n')
    await unlink(join(repo, 'todelete.txt'))

    const files = await getWorkingChangedFiles(repo)
    expect(files).toContainEqual({ filePath: 'README.md', status: 'modified', insertions: 0, deletions: 0 })
    expect(files).toContainEqual({ filePath: 'new.txt', status: 'added', insertions: 0, deletions: 0 })
    expect(files).toContainEqual({ filePath: 'todelete.txt', status: 'deleted', insertions: 0, deletions: 0 })
  })
})

describe('git.service commit statuses', () => {
  it('treats every commit as unpushed when there is no remote branch', async () => {
    await commitFile('a.txt', 'a\n', 'second')
    const statuses = await getCommitStatuses(repo)
    expect(statuses.unpushedHashes).toHaveLength(2)
  })

  it('reports only commits ahead of origin as unpushed once pushed', async () => {
    await addOrigin()
    const g = simpleGit(repo)
    await g.raw(['fetch', 'origin'])
    const newSha = await commitFile('a.txt', 'a\n', 'ahead')
    const statuses = await getCommitStatuses(repo)
    expect(statuses.unpushedHashes).toEqual([newSha])
  })

  it('newBranchHashes lists commits unique to the branch vs main', async () => {
    const g = simpleGit(repo)
    await g.checkoutLocalBranch('feature')
    const sha = await commitFile('f.txt', 'f\n', 'feature work')
    const statuses = await getCommitStatuses(repo)
    expect(statuses.newBranchHashes).toEqual([sha])
  })
})

describe('git.service branch comparison (PR preview)', () => {
  async function setupTopicBranch(): Promise<void> {
    const g = simpleGit(repo)
    await commitFile('del.txt', 'delete me\n', 'add del')
    await g.checkoutLocalBranch('topic')
    await writeFile(join(repo, 'new.txt'), 'line1\nline2\n')
    await writeFile(join(repo, 'README.md'), 'changed\n')
    await g.raw(['rm', 'del.txt'])
    await g.add(['new.txt', 'README.md'])
    await g.commit('topic changes')
  }

  it('getCompareFiles classifies added/modified/deleted files with line stats', async () => {
    await setupTopicBranch()
    const files = await getCompareFiles(repo, 'main')
    const byPath = Object.fromEntries(files.map((f) => [f.path, f]))
    expect(byPath['new.txt']).toMatchObject({ status: 'added', additions: 2, deletions: 0 })
    expect(byPath['README.md']).toMatchObject({ status: 'modified', additions: 1, deletions: 1 })
    expect(byPath['del.txt']).toMatchObject({ status: 'deleted', additions: 0, deletions: 1 })
  })

  it('getCompareDiff returns the full three-dot diff', async () => {
    await setupTopicBranch()
    const diff = await getCompareDiff(repo, 'main')
    expect(diff).toContain('new.txt')
    expect(diff).toContain('+line1')
    expect(diff).toContain('-hello')
  })

  it('getCompareFileDiff scopes the diff to a single file', async () => {
    await setupTopicBranch()
    const diff = await getCompareFileDiff(repo, 'main', 'README.md')
    expect(diff).toContain('+changed')
    expect(diff).not.toContain('new.txt')
  })

  it('getCompareCommits lists branch commits newest-first', async () => {
    await setupTopicBranch()
    await commitFile('more.txt', 'more\n', 'second topic commit')
    const commits = await getCompareCommits(repo, 'main')
    expect(commits).toHaveLength(2)
    expect(commits[0].message).toBe('second topic commit')
    expect(commits[1].message).toBe('topic changes')
  })
})

describe('git.service per-file mutations', () => {
  it('discardFile deletes an untracked file', async () => {
    await writeFile(join(repo, 'scratch.txt'), 'x\n')
    await discardFile(repo, 'scratch.txt')
    expect(existsSync(join(repo, 'scratch.txt'))).toBe(false)
  })

  it('discardFile restores a tracked file to HEAD content (staged + worktree)', async () => {
    const g = simpleGit(repo)
    await writeFile(join(repo, 'README.md'), 'modified\n')
    await g.add('README.md')
    await discardFile(repo, 'README.md')
    const status = await g.status()
    expect(status.files).toHaveLength(0)
  })

  it('stageFile stages and unstageFile unstages a file', async () => {
    const g = simpleGit(repo)
    await writeFile(join(repo, 'README.md'), 'mod\n')

    await stageFile(repo, 'README.md')
    expect((await g.status()).staged).toContain('README.md')

    await unstageFile(repo, 'README.md')
    const after = await g.status()
    expect(after.staged).toHaveLength(0)
    expect(after.modified).toContain('README.md')
  })

  it('stashFile stashes only the named file and reverts it in the worktree', async () => {
    const g = simpleGit(repo)
    await commitFile('other.txt', 'other\n', 'add other')
    await writeFile(join(repo, 'README.md'), 'stash-me\n')
    await writeFile(join(repo, 'other.txt'), 'keep-me\n')

    await stashFile(repo, 'README.md')

    const { readFile } = await import('fs/promises')
    expect(await readFile(join(repo, 'README.md'), 'utf-8')).toBe('hello\n')
    expect(await readFile(join(repo, 'other.txt'), 'utf-8')).toBe('keep-me\n')
    const stashes = await g.raw(['stash', 'list'])
    expect(stashes).toContain('codecrucible: ad-hoc stash of README.md')
  })
})

describe('git.service showFile helpers', () => {
  it('showFile reads a file at a ref as text', async () => {
    await writeFile(join(repo, 'README.md'), 'working-copy\n')
    expect(await showFile(repo, 'main', 'README.md')).toBe('hello\n')
  })

  it('showFile returns null for a path that does not exist at the ref', async () => {
    expect(await showFile(repo, 'main', 'missing.txt')).toBeNull()
  })

  it('showFileBase64 returns base64-encoded blob content', async () => {
    const b64 = await showFileBase64(repo, 'main', 'README.md')
    expect(b64).not.toBeNull()
    expect(Buffer.from(b64!, 'base64').toString('utf-8')).toBe('hello\n')
  })

  it('showFileBase64 returns null for an unknown ref', async () => {
    expect(await showFileBase64(repo, 'no-such-ref', 'README.md')).toBeNull()
  })
})
