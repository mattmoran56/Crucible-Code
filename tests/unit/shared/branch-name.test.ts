import { describe, expect, it } from 'vitest'
import {
  defaultSessionBranch,
  isDefaultSessionBranch,
  renameMovesBranch,
  sessionDeletesLocalBranch,
  sessionRemoteBranch,
  validateBranchName,
} from '../../../src/shared/branch-name'

describe('defaultSessionBranch', () => {
  it('uses session/<name> for local and cloud', () => {
    expect(defaultSessionBranch('fix-login', 'local')).toBe('session/fix-login')
    expect(defaultSessionBranch('fix-login', 'cloud')).toBe('session/fix-login')
  })

  it('recognises the default branch for a name', () => {
    expect(isDefaultSessionBranch('session/a', 'a')).toBe(true)
    expect(isDefaultSessionBranch('feature/a', 'a')).toBe(false)
  })
})

describe('validateBranchName', () => {
  it.each(['session/foo', 'feat/cloud-sessions', 'a', 'x.y/z_1', 'claude/fix-123'])('accepts %s', (b) => {
    expect(validateBranchName(b)).toBeNull()
  })

  it.each([
    '',
    '   ',
    'has space',
    '-leading',
    '/leading',
    'trailing/',
    'foo.lock',
    'foo.',
    'a..b',
    'a~b',
    'a^b',
    'a:b',
    'a?b',
    'a*b',
    'a[b',
    'a\\b',
    'a@{b',
    'a//b',
    'a/.hidden',
    '@',
  ])('rejects %j', (b) => {
    expect(validateBranchName(b)).toEqual(expect.any(String))
  })
})

describe('session branch helpers', () => {
  it('sessionRemoteBranch prefers the cloud branch', () => {
    expect(sessionRemoteBranch({ branchName: 'session/a' })).toBe('session/a')
    expect(sessionRemoteBranch({ branchName: 'session/a', cloud: { sessionId: 's', url: 'u', branch: 'feat/b' } })).toBe('feat/b')
  })

  it('sessionDeletesLocalBranch: session/* or app-owned', () => {
    expect(sessionDeletesLocalBranch({ branchName: 'session/a' })).toBe(true)
    expect(sessionDeletesLocalBranch({ branchName: 'feat/a' })).toBe(false)
    expect(sessionDeletesLocalBranch({ branchName: 'feat/a', ownsBranch: true })).toBe(true)
  })

  it('renameMovesBranch only for local sessions on their default branch', () => {
    expect(renameMovesBranch({ name: 'a', branchName: 'session/a' })).toBe(true)
    expect(renameMovesBranch({ name: 'a', branchName: 'feat/a' })).toBe(false)
    expect(renameMovesBranch({ name: 'a', branchName: 'session/a', cloud: { sessionId: 's', url: 'u' } })).toBe(false)
  })
})
