import { describe, expect, it } from 'vitest'
import { sessionsToDropCapture } from '../../../src/renderer/lib/localPrCapture'
import type { LocalPR, Session } from '../../../src/shared/types'

// ── builders ─────────────────────────────────────────────────────────────────

function session(id: string, overrides: Partial<Session> = {}): Session {
  return {
    id,
    name: id,
    branchName: `session/${id}`,
    worktreePath: `/wt/${id}`,
    projectId: 'proj-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

let seq = 0
function lpr(overrides: Partial<LocalPR> = {}): LocalPR {
  seq += 1
  return {
    id: `lpr-${seq}`,
    localNumber: seq,
    projectId: 'proj-1',
    title: 'A change',
    body: 'body',
    branch: 'feat/x',
    baseBranch: 'main',
    status: 'local',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    log: [],
    ...overrides,
  }
}

/** A promoted local PR: owns a session and has a real GitHub PR number. */
function promoted(sessionId: string, overrides: Partial<LocalPR> = {}): LocalPR {
  return lpr({ sessionId, status: 'open', realPrNumber: 101, realPrUrl: 'https://github.com/o/r/pull/101', ...overrides })
}

const ids = (sessions: Session[]): string[] => sessions.map((s) => s.id).sort()

// ── tests ────────────────────────────────────────────────────────────────────

describe('sessionsToDropCapture', () => {
  it('returns nothing for empty inputs', () => {
    expect(sessionsToDropCapture([], [])).toEqual([])
    expect(sessionsToDropCapture([promoted('s1')], [])).toEqual([])
    expect(sessionsToDropCapture([], [session('s1', { captureLocalPr: true })])).toEqual([])
  })

  it('drops capture for a session whose local PR was promoted', () => {
    const sessions = [session('s1', { captureLocalPr: true })]
    const result = sessionsToDropCapture([promoted('s1')], sessions)
    expect(ids(result)).toEqual(['s1'])
  })

  it('leaves capture alone when the local PR is not yet promoted (no realPrNumber)', () => {
    const sessions = [session('s1', { captureLocalPr: true })]
    // status 'local', no realPrNumber → still owned locally, keep shimming.
    expect(sessionsToDropCapture([lpr({ sessionId: 's1' })], sessions)).toEqual([])
  })

  it('does not touch a session that already has capture off', () => {
    const sessions = [session('s1', { captureLocalPr: false }), session('s2')]
    // s2 has captureLocalPr undefined.
    expect(sessionsToDropCapture([promoted('s1'), promoted('s2')], sessions)).toEqual([])
  })

  it('treats only `captureLocalPr === true` as on (not truthy coercion)', () => {
    // Defensive: an undefined flag must not be dropped (no-op vs. spurious save).
    const sessions = [session('s1', { captureLocalPr: undefined })]
    expect(sessionsToDropCapture([promoted('s1')], sessions)).toEqual([])
  })

  it('ignores promoted PRs with no owning session', () => {
    const sessions = [session('s1', { captureLocalPr: true })]
    const orphan = lpr({ sessionId: undefined, status: 'open', realPrNumber: 5 })
    expect(sessionsToDropCapture([orphan], sessions)).toEqual([])
  })

  it('ignores a promoted PR whose session is not in the list', () => {
    const sessions = [session('s1', { captureLocalPr: true })]
    expect(sessionsToDropCapture([promoted('s-other')], sessions)).toEqual([])
  })

  it('only drops the sessions that were actually promoted in a mixed set', () => {
    const sessions = [
      session('s1', { captureLocalPr: true }), // promoted → drop
      session('s2', { captureLocalPr: true }), // still local → keep
      session('s3', { captureLocalPr: false }), // promoted but capture off → keep
      session('s4'), // no PR at all → keep
    ]
    const localPRs = [promoted('s1'), lpr({ sessionId: 's2' }), promoted('s3')]
    expect(ids(sessionsToDropCapture(localPRs, sessions))).toEqual(['s1'])
  })

  it('returns each session once even with several promoted PRs (a stack)', () => {
    const sessions = [session('s1', { captureLocalPr: true })]
    const stack = [promoted('s1', { realPrNumber: 1 }), promoted('s1', { realPrNumber: 2 })]
    const result = sessionsToDropCapture(stack, sessions)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('s1')
  })

  it('drops the session if ANY of its local PRs is promoted (mixed stack)', () => {
    const sessions = [session('s1', { captureLocalPr: true })]
    const mixed = [lpr({ sessionId: 's1' }), promoted('s1')]
    expect(ids(sessionsToDropCapture(mixed, sessions))).toEqual(['s1'])
  })

  it('drops capture for a merged PR that carries a realPrNumber', () => {
    const sessions = [session('s1', { captureLocalPr: true })]
    const merged = promoted('s1', { status: 'merged' })
    expect(ids(sessionsToDropCapture([merged], sessions))).toEqual(['s1'])
  })

  it('is idempotent: re-running after the flag is cleared yields nothing', () => {
    const localPRs = [promoted('s1')]
    const before = sessionsToDropCapture(localPRs, [session('s1', { captureLocalPr: true })])
    expect(before).toHaveLength(1)
    // Simulate the flag having been cleared by the previous dispatch.
    const after = sessionsToDropCapture(localPRs, [session('s1', { captureLocalPr: false })])
    expect(after).toEqual([])
  })

  it('carries projectId through so the caller can persist per project', () => {
    const sessions = [session('s1', { captureLocalPr: true, projectId: 'proj-9' })]
    const result = sessionsToDropCapture([promoted('s1', { projectId: 'proj-9' })], sessions)
    expect(result[0].projectId).toBe('proj-9')
  })

  it('does not mutate its inputs', () => {
    const sessions = [session('s1', { captureLocalPr: true })]
    const localPRs = [promoted('s1')]
    const sessionsCopy = JSON.parse(JSON.stringify(sessions))
    const localPRsCopy = JSON.parse(JSON.stringify(localPRs))
    sessionsToDropCapture(localPRs, sessions)
    expect(sessions).toEqual(sessionsCopy)
    expect(localPRs).toEqual(localPRsCopy)
  })
})
