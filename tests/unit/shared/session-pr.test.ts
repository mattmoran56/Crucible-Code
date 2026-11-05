import { describe, expect, it } from 'vitest'
import { canAssignSessionPR, sessionPullRequest, withAssignedPR } from '../../../src/shared/session-pr'
import type { PullRequest, Session } from '../../../src/shared/types'

const pr = (number: number, headRefName: string): PullRequest =>
  ({ number, headRefName, title: `PR ${number}`, state: 'OPEN' }) as PullRequest

const prs = [pr(1, 'session/one'), pr(2, 'main'), pr(3, 'session/three')]

const session = (overrides: Partial<Session> = {}): Session => ({
  id: 's',
  name: 'S',
  branchName: 'session/one',
  worktreePath: '/wt/one',
  projectId: 'p',
  createdAt: '2026-01-01T00:00:00Z',
  ...overrides,
})

describe('sessionPullRequest', () => {
  it('matches a worktree session by branch', () => {
    expect(sessionPullRequest(session(), prs)?.number).toBe(1)
    expect(sessionPullRequest(session({ branchName: 'session/none' }), prs)).toBeUndefined()
    expect(sessionPullRequest(undefined, prs)).toBeUndefined()
  })

  it('gives a repo-root session only its assigned PR, never one matched by branch', () => {
    const root = session({ repoRoot: true, branchName: '' })
    expect(sessionPullRequest(root, prs)).toBeUndefined()
    expect(sessionPullRequest({ ...root, prNumber: 3 }, prs)?.number).toBe(3)
    expect(sessionPullRequest({ ...root, prNumber: 99 }, prs)).toBeUndefined()
  })

  it('prefers an assigned PR over the branch match', () => {
    expect(sessionPullRequest(session({ prNumber: 3 }), prs)?.number).toBe(3)
  })
})

describe('canAssignSessionPR / withAssignedPR', () => {
  it('only lets repo-root sessions take an assigned PR', () => {
    expect(canAssignSessionPR(session({ repoRoot: true }))).toBe(true)
    expect(canAssignSessionPR(session())).toBe(false)
  })

  it('sets and clears the assignment without touching anything else', () => {
    const assigned = withAssignedPR(session({ repoRoot: true }), 5)
    expect(assigned.prNumber).toBe(5)
    const cleared = withAssignedPR(assigned, null)
    expect('prNumber' in cleared).toBe(false)
    expect(cleared.repoRoot).toBe(true)
  })
})
