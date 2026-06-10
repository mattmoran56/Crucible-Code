import { describe, expect, it, vi, beforeEach } from 'vitest'

const execFileMock = vi.fn()

function fakeExecFile(cmd: string, args: string[], opts: any, cb: any) {
  const callback = typeof opts === 'function' ? opts : cb
  try {
    const result = execFileMock(cmd, args, opts)
    callback(null, { stdout: String(result ?? ''), stderr: '' })
  } catch (err: any) {
    callback(err, { stdout: '', stderr: err?.message ?? '' })
  }
}
vi.mock('child_process', () => ({
  default: { execFile: fakeExecFile },
  execFile: fakeExecFile,
  spawn: () => ({}),
}))
vi.mock('node:child_process', () => ({
  default: { execFile: fakeExecFile },
  execFile: fakeExecFile,
  spawn: () => ({}),
}))

import { createDraftPR, findPRForBranch, markPRReady } from '../../../src/main/services/github.service'

beforeEach(() => {
  execFileMock.mockReset()
})

describe('createDraftPR', () => {
  it('parses the PR number from a fresh gh pr create URL', async () => {
    execFileMock.mockImplementation((_cmd: string, args: string[]) => {
      if (args[0] === 'pr' && args[1] === 'create') {
        return 'https://github.com/foo/bar/pull/42\n'
      }
      throw new Error('unexpected args ' + JSON.stringify(args))
    })
    const info = await createDraftPR('/tmp/wt', { title: 't', body: 'b', base: 'main', head: 'foundry/x' })
    expect(info).toMatchObject({ number: 42, isDraft: true })
    expect(info.url).toContain('/pull/42')
  })

  it('falls back to findPRForBranch on "already exists"', async () => {
    execFileMock.mockImplementation((_cmd: string, args: string[]) => {
      if (args[0] === 'pr' && args[1] === 'create') {
        throw new Error('a pull request for branch "foundry/x" already exists')
      }
      if (args[0] === 'pr' && args[1] === 'list') {
        return JSON.stringify([{ number: 99, url: 'https://github.com/foo/bar/pull/99', isDraft: false }])
      }
      throw new Error('unexpected: ' + JSON.stringify(args))
    })
    const info = await createDraftPR('/tmp/wt', { title: 't', body: 'b', base: 'main', head: 'foundry/x' })
    expect(info).toMatchObject({ number: 99, isDraft: false })
  })
})

describe('findPRForBranch', () => {
  it('returns null when gh returns no PRs', async () => {
    execFileMock.mockReturnValue('[]')
    expect(await findPRForBranch('/tmp/wt', 'feat/none')).toBeNull()
  })

  it('returns first PR', async () => {
    execFileMock.mockReturnValue(JSON.stringify([
      { number: 12, url: 'https://github.com/o/r/pull/12', isDraft: true },
    ]))
    expect(await findPRForBranch('/tmp/wt', 'feat/x')).toEqual({
      number: 12,
      url: 'https://github.com/o/r/pull/12',
      isDraft: true,
    })
  })

  it('returns null on error', async () => {
    execFileMock.mockImplementation(() => { throw new Error('gh: not authenticated') })
    expect(await findPRForBranch('/tmp/wt', 'feat/x')).toBeNull()
  })
})

describe('markPRReady', () => {
  it('passes through on success', async () => {
    execFileMock.mockReturnValue('')
    await expect(markPRReady('/tmp/wt', 42)).resolves.toBeUndefined()
  })

  it('swallows "already ready"', async () => {
    execFileMock.mockImplementation(() => { throw new Error('Pull request #42 is already ready for review') })
    await expect(markPRReady('/tmp/wt', 42)).resolves.toBeUndefined()
  })

  it('rethrows unrelated errors', async () => {
    execFileMock.mockImplementation(() => { throw new Error('rate limit exceeded') })
    await expect(markPRReady('/tmp/wt', 42)).rejects.toThrow(/rate limit/)
  })
})
