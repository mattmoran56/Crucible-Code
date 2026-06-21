import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReviewLoopState } from '../../../src/shared/types'

const h = vi.hoisted(() => {
  const s: any = {
    phaseCalls: [],
    failTab: null,
    holdTab: null,
    issues: [], // what round-N-issues.json contains
    triaged: [], // what round-N-triage.json contains
    filesExist: true, // existsSync result for the json intermediates
    execCalls: [],
  }
  // gh mock (sticky PR comment). Callback-style so promisify(execFile) resolves
  // with the {stdout} object.
  s.execFileMock = (cmd: string, args: string[], _opts: unknown, cb: Function) => {
    const callback = (typeof _opts === 'function' ? _opts : cb) as (e: unknown, r: unknown) => void
    s.execCalls.push({ cmd, args })
    callback(null, { stdout: '[]', stderr: '' })
  }
  return s
})

vi.mock('../../../src/main/services/review-phase.service', () => ({
  DEFAULT_PHASE_TIMEOUT_MS: 1000,
  runForegroundPhase: vi.fn((opts: Record<string, any>) => {
    h.phaseCalls.push(opts)
    opts.onSpawn?.(`term-${opts.tabId}`)
    if (h.holdTab && opts.tabId === h.holdTab) {
      return new Promise((resolve) => {
        opts.signal?.addEventListener('abort', () =>
          resolve({ ok: false, terminalId: `term-${opts.tabId}`, output: '', error: 'cancelled' })
        )
      })
    }
    if (h.failTab && opts.tabId === h.failTab) {
      return Promise.resolve({ ok: false, terminalId: `term-${opts.tabId}`, output: '', error: 'phase blew up' })
    }
    return Promise.resolve({ ok: true, terminalId: `term-${opts.tabId}`, output: `OUT:${opts.tabId}` })
  }),
}))

// The Pro variant hands data between phases through JSON files on disk.
vi.mock('node:fs/promises', () => {
  const m = {
    mkdir: async () => undefined,
    unlink: async () => undefined,
    readFile: async (p: string) => {
      if (p.includes('issues.json')) return JSON.stringify(h.issues)
      if (p.includes('triage.json')) return JSON.stringify(h.triaged)
      return '[]'
    },
  }
  return { ...m, default: m }
})
vi.mock('node:fs', () => {
  const m = { existsSync: () => h.filesExist }
  return { ...m, default: m }
})
vi.mock('child_process', () => ({
  default: { execFile: h.execFileMock },
  execFile: h.execFileMock,
  spawn: () => ({}),
}))
vi.mock('node:child_process', () => ({
  default: { execFile: h.execFileMock },
  execFile: h.execFileMock,
  spawn: () => ({}),
}))

import {
  startReviewLoop,
  setReviewLoopWindow,
  getReviewLoopState,
  cancelReviewLoop,
} from '../../../src/main/services/review-loop.service'

const sentStates: ReviewLoopState[] = []
const fakeWindow = {
  isDestroyed: () => false,
  webContents: { send: (_c: string, state: ReviewLoopState) => sentStates.push(state) },
} as unknown as Electron.BrowserWindow
const latest = (): ReviewLoopState | undefined => sentStates[sentStates.length - 1]

const opts = (over: Record<string, any> = {}) => ({
  sessionId: 'sess-pro',
  worktreePath: '/wt/sess-pro',
  branch: 'feat/x',
  baseBranch: 'main',
  config: { enabled: true, variant: 'pro' as const, maxIterations: 5, consecutiveCleanRounds: 1 },
  prNumber: 7,
  repoPath: '/repo',
  ...over,
})

beforeEach(() => {
  h.phaseCalls = []
  h.failTab = null
  h.holdTab = null
  h.issues = []
  h.triaged = []
  h.filesExist = true
  h.execCalls = []
  sentStates.length = 0
  setReviewLoopWindow(fakeWindow)
})

describe('startReviewLoop (Pro)', () => {
  it('converges in one round when review finds no issues (triage + fix skipped)', async () => {
    h.issues = []
    await startReviewLoop(opts())
    await vi.waitFor(() => expect(latest()?.status).not.toBe('running'))

    expect(h.phaseCalls.map((c) => c.tabId)).toEqual(['review-loop:r1:review'])
    const final = latest()!
    expect(final.status).toBe('completed')
    expect(final.stopReason).toBe('converged')
    const slots = final.rounds[0].phaseSlots
    expect(slots.find((s) => s.phase === 'review')!.status).toBe('completed')
    expect(slots.find((s) => s.phase === 'triage')!.status).toBe('skipped')
    expect(slots.find((s) => s.phase === 'fix')!.status).toBe('skipped')
  })

  it('runs all three phases when triage flags a fixable issue', async () => {
    h.issues = [{ id: 'i1', title: 'bug', description: 'd', file: 'src/a.ts', line: 1, category: 'bug' }]
    h.triaged = [{ id: 'i1', title: 'bug', description: 'd', file: 'src/a.ts', line: 1, category: 'bug', introducedInPR: true, decision: 'fix', justification: 'real' }]
    await startReviewLoop(opts({ config: { enabled: true, variant: 'pro', maxIterations: 1, consecutiveCleanRounds: 2 } }))
    await vi.waitFor(() => expect(latest()?.status).not.toBe('running'))

    expect(h.phaseCalls.map((c) => c.tabId)).toEqual([
      'review-loop:r1:review',
      'review-loop:r1:triage',
      'review-loop:r1:fix',
    ])
    const final = latest()!
    expect(final.stopReason).toBe('maxIterations') // never hit a clean round
    expect(final.rounds[0].rawIssues).toHaveLength(1)
    expect(final.rounds[0].triaged[0].decision).toBe('fix')
    // The fix prompt is scoped to the triage-approved file allowlist.
    const fixCall = h.phaseCalls.find((c) => c.tabId === 'review-loop:r1:fix')!
    expect(fixCall.prompt).toContain('src/a.ts')
  })

  it('errors when the review phase does not write the issues file', async () => {
    h.filesExist = false // existsSync(issuesPath) → false
    await startReviewLoop(opts())
    await vi.waitFor(() => expect(latest()?.status).not.toBe('running'))

    const final = latest()!
    expect(final.status).toBe('error')
    expect(final.errorMessage).toMatch(/did not write issues file/)
    expect(h.phaseCalls).toHaveLength(1) // triage/fix never ran
  })

  it('tracks skipped/deferred issues for the PR comment', async () => {
    h.issues = [{ id: 'i1', title: 'nit', description: 'd', file: 'src/a.ts', line: 1, category: 'style' }]
    h.triaged = [{ id: 'i1', title: 'nit', description: 'd', file: 'src/a.ts', line: 1, category: 'style', introducedInPR: false, decision: 'defer', justification: 'out of scope' }]
    await startReviewLoop(opts())
    await vi.waitFor(() => expect(latest()?.status).not.toBe('running'))

    const final = latest()!
    // 0 fixable → clean round → converged; the deferred item is recorded.
    expect(final.stopReason).toBe('converged')
    expect(final.skippedIssues.map((i) => i.id)).toEqual(['i1'])
    expect(final.rounds[0].phaseSlots.find((s) => s.phase === 'fix')!.status).toBe('skipped')
  })

  it('cancels cleanly mid-phase, finalizing as cancelled', async () => {
    h.holdTab = 'review-loop:r1:review'
    await startReviewLoop(opts())
    await vi.waitFor(() => expect(getReviewLoopState('sess-pro')?.status).toBe('running'))

    cancelReviewLoop('sess-pro')
    await vi.waitFor(() => expect(latest()?.status).not.toBe('running'))
    expect(latest()!.status).toBe('cancelled')
    expect(latest()!.stopReason).toBe('cancelled')
  })
})
