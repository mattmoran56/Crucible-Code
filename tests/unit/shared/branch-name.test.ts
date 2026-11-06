import { describe, expect, it } from 'vitest'
import {
  defaultSessionBranch,
  isDefaultSessionBranch,
  placeholderSessionBranch,
  placeholderSessionName,
  toTypedBranchName,
  uniqueBranchName,
  renameMovesBranch,
  sessionDeletesLocalBranch,
  sessionNameSlug,
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
    expect(isDefaultSessionBranch('session/fix-auth', 'Fix Auth')).toBe(true)
  })

  it('lowercases a human-readable name and hyphenates its spaces', () => {
    expect(sessionNameSlug('  Fix The   Auth Bug ')).toBe('fix-the-auth-bug')
    expect(sessionNameSlug('fix/Misc Stuff')).toBe('fix/misc-stuff')
    expect(defaultSessionBranch('Fix Auth Bug', 'cloud')).toBe('session/fix-auth-bug')
    expect(renameMovesBranch({ name: 'Fix Auth', branchName: 'session/fix-auth' })).toBe(true)
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
  it('sessionRemoteBranch follows the session branch (reality after a teleport), falling back to the cloud one', () => {
    expect(sessionRemoteBranch({ branchName: 'session/a' })).toBe('session/a')
    expect(sessionRemoteBranch({ branchName: 'claude/a-x', cloud: { sessionId: 's', url: 'u', branch: 'session/a' } })).toBe('claude/a-x')
    expect(sessionRemoteBranch({ branchName: '', cloud: { sessionId: 's', url: 'u', branch: 'feat/b' } })).toBe('feat/b')
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
    expect(
      renameMovesBranch({ name: 'a', branchName: 'session/a', cloudPending: { task: 't', branch: 'session/a', createdAt: '' } })
    ).toBe(false)
  })
})

describe('toTypedBranchName', () => {
  it('keeps feat/fix/chore and slugs the description', () => {
    expect(toTypedBranchName('feat/dark-mode-toggle')).toBe('feat/dark-mode-toggle')
    expect(toTypedBranchName('Fix: Login Redirect loop')).toBe('fix/login-redirect-loop')
    expect(toTypedBranchName('`chore/bump deps`')).toBe('chore/bump-deps')
  })

  it('maps feature/bugfix and defaults an untyped branch to chore', () => {
    expect(toTypedBranchName('feature/x-y')).toBe('feat/x-y')
    expect(toTypedBranchName('bugfix/x')).toBe('fix/x')
    expect(toTypedBranchName('update readme')).toBe('chore/update-readme')
  })

  it('keeps the description short', () => {
    expect(toTypedBranchName('feat/one two three four five six seven')).toBe('feat/one-two-three-four-five')
    expect(toTypedBranchName(`fix/${'a'.repeat(60)}`)).toBeNull()
  })

  it('falls back to the given description, else null', () => {
    expect(toTypedBranchName('feat/', 'Dark mode')).toBe('feat/dark-mode')
    expect(toTypedBranchName('', '')).toBeNull()
  })

  it('always produces a valid branch name', () => {
    for (const raw of ['feat/..lock', 'fix/a~b^c', 'chore/@{x}', 'fix/ -x ']) {
      const b = toTypedBranchName(raw, 'fallback')
      expect(b && validateBranchName(b)).toBeNull()
    }
  })
})

describe('uniqueBranchName', () => {
  it('adds -2, -3… until free', () => {
    expect(uniqueBranchName('fix/a', ['main'])).toBe('fix/a')
    expect(uniqueBranchName('fix/a', ['fix/a', 'fix/a-2'])).toBe('fix/a-3')
  })
})

describe('placeholder names', () => {
  it('names a pending session new-session-<random> on its default branch', () => {
    expect(placeholderSessionName(() => 'abc123')).toBe('new-session-abc123')
    expect(placeholderSessionBranch('new-session-abc123', true)).toBe('session/new-session-abc123')
  })

  it('suffixes a typed name so it never takes the name’s own default branch', () => {
    expect(placeholderSessionBranch('Login', false, () => 'abc123')).toBe('session/login-abc123')
  })
})
