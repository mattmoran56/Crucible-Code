import { describe, expect, it } from 'vitest'
import { canAssignSessionPR, cloudSessionIdsIn, sessionPullRequest, withAssignedPR } from '../../../src/shared/session-pr'
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

  it('finds a cloud session\'s PR opened from the branch the cloud agent was told to use', () => {
    const cloud = session({ branchName: 'session/local', cloud: { sessionId: 'session_abc', url: 'u', branch: 'session/three' } })
    expect(sessionPullRequest(cloud, prs)?.number).toBe(3)
  })

  it('finds a cloud session\'s PR opened from a branch of its own, by the session link in its description', () => {
    const cloudPR = { ...pr(7, 'claude/fix-thing-x1y2'), cloudSessionIds: ['session_abc'] }
    const cloud = session({ branchName: 'fix/thing', cloud: { sessionId: 'session_abc', url: 'u', branch: 'fix/thing' } })
    expect(sessionPullRequest(cloud, [...prs, cloudPR])?.number).toBe(7)
    expect(sessionPullRequest({ ...cloud, cloud: { ...cloud.cloud!, sessionId: 'session_other' } }, [...prs, cloudPR])).toBeUndefined()
  })

  it('never matches a local session by a cloud session link', () => {
    const cloudPR = { ...pr(7, 'claude/x'), cloudSessionIds: ['session_abc'] }
    expect(sessionPullRequest(session({ branchName: 'fix/thing' }), [cloudPR])).toBeUndefined()
  })
})

describe('cloudSessionIdsIn', () => {
  it('pulls every distinct claude.ai/code session id out of a PR description', () => {
    const body = 'Fixes it.\n\nhttps://claude.ai/code/session_01ThHX\nClaude-Session: https://claude.ai/code/session_01ThHX\nsee claude.ai/code/session_02Ab'
    expect(cloudSessionIdsIn(body)).toEqual(['session_01ThHX', 'session_02Ab'])
  })

  it('is empty for a description with no session link', () => {
    expect(cloudSessionIdsIn('https://claude.ai/code')).toEqual([])
    expect(cloudSessionIdsIn(null)).toEqual([])
    expect(cloudSessionIdsIn(undefined)).toEqual([])
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
