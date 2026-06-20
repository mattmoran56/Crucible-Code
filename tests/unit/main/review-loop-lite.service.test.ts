import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReviewLoopState } from '../../../src/shared/types'

// All shared state + the git mock live in the hoisted block so the vi.mock
// factories (also hoisted) can reference them without a TDZ error.
const h = vi.hoisted(() => {
  const s: any = {
    phaseCalls: [],
    failTab: null,
    sameSha: true,
    shaCounter: 0,
    dirty: false,
  }
  s.nextSha = () => (s.sameSha ? 'SHA-CONST' : `SHA-${s.shaCounter++}`)

  // git mock: a callback-style execFile that calls back with a {stdout,stderr}
  // object, so the default promisify(execFile) the service uses resolves to that
  // object and `const { stdout } = await ...` works without a custom symbol.
  // Branch on the subcommand: rev-parse drives convergence; status drives the
  // trailing-commit safety net; diff feeds the no-PR review prompt.
  s.execFileMock = (_file: string, args: string[], _opts: unknown, cb: Function) => {
    const callback = (typeof _opts === 'function' ? _opts : cb) as (e: unknown, r: unknown) => void
    const a = args ?? []
    let stdout = ''
    if (a[0] === 'rev-parse') stdout = s.nextSha()
    else if (a[0] === 'status') stdout = s.dirty ? ' M file.ts\n' : ''
    else if (a[0] === 'diff') stdout = 'DIFF-CONTENT'
    callback(null, { stdout, stderr: '' })
  }
  return s
})

// Foreground phase runner: resolve synchronously so the loop drives to
// completion within microtasks. Each phase's "output" is tagged with its tab
// id so we can assert the review→triage→fix handoff. A failTab forces failure;
// a holdTab returns a promise that only settles when its signal aborts.
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
  startReviewLoopLite,
  setReviewLoopLiteWindow,
  getReviewLoopLiteState,
  cancelReviewLoopLite,
} from '../../../src/main/services/review-loop-lite.service'

const sentStates: ReviewLoopState[] = []
const fakeWindow = {
  isDestroyed: () => false,
  webContents: {
    send: (_channel: string, state: ReviewLoopState) => sentStates.push(state),
  },
} as unknown as Electron.BrowserWindow

const latest = (): ReviewLoopState | undefined => sentStates[sentStates.length - 1]

const opts = (over: Record<string, any> = {}) => ({
  sessionId: 'sess-1',
  worktreePath: '/wt/sess-1',
  branch: 'feat/x',
  baseBranch: 'main',
  config: { enabled: true, variant: 'lite' as const, maxIterations: 5, consecutiveCleanRounds: 1 },
  prNumber: 42,
  repoPath: '/repo',
  ...over,
})

beforeEach(() => {
  h.phaseCalls = []
  h.failTab = null
  h.holdTab = null
  h.sameSha = true
  h.shaCounter = 0
  h.dirty = false
  sentStates.length = 0
  setReviewLoopLiteWindow(fakeWindow)
})

describe('startReviewLoopLite', () => {
  it('runs review → triage → fix as three foreground phases and converges', async () => {
    await startReviewLoopLite(opts())
    await vi.waitFor(() => expect(latest()?.status).not.toBe('running'))

    const tabs = h.phaseCalls.map((c) => c.tabId)
    expect(tabs).toEqual([
      'review-loop:r1:review',
      'review-loop:r1:triage',
      'review-loop:r1:fix',
    ])

    const final = latest()!
    expect(final.status).toBe('completed')
    expect(final.stopReason).toBe('converged')
    expect(final.iteration).toBe(1)
    expect(final.variant).toBe('lite')

    const slots = final.rounds[0].phaseSlots
    expect(slots.map((s) => s.status)).toEqual(['completed', 'completed', 'completed'])
    expect(slots.map((s) => s.terminalId)).toEqual([
      'term-review-loop:r1:review',
      'term-review-loop:r1:triage',
      'term-review-loop:r1:fix',
    ])
  })

  it('hands each phase output to the next phase prompt', async () => {
    await startReviewLoopLite(opts())
    await vi.waitFor(() => expect(latest()?.status).not.toBe('running'))

    const [review, triage, fix] = h.phaseCalls
    expect(review.prompt).toContain('/review 42')
    expect(review.skipPermissions).toBe(true)
    // triage consumes the review terminal's output
    expect(triage.prompt).toContain('OUT:review-loop:r1:review')
    // fix consumes the triage terminal's output
    expect(fix.prompt).toContain('OUT:review-loop:r1:triage')
  })

  it('falls back to the branch diff in the review prompt when there is no PR', async () => {
    await startReviewLoopLite(opts({ prNumber: undefined }))
    await vi.waitFor(() => expect(latest()?.status).not.toBe('running'))
    expect(h.phaseCalls[0].prompt).toContain('/review')
    expect(h.phaseCalls[0].prompt).toContain('DIFF-CONTENT')
  })

  it('stops at the iteration cap when rounds keep producing commits', async () => {
    h.sameSha = false // every round advances HEAD → never converges
    await startReviewLoopLite(opts({ config: { enabled: true, variant: 'lite', maxIterations: 2, consecutiveCleanRounds: 2 } }))
    await vi.waitFor(() => expect(latest()?.status).not.toBe('running'))

    const final = latest()!
    expect(final.stopReason).toBe('maxIterations')
    expect(final.iteration).toBe(2)
    expect(h.phaseCalls).toHaveLength(6) // 3 phases × 2 rounds
  })

  it('finalizes as error and skips later phases when a phase fails', async () => {
    h.failTab = 'review-loop:r1:review'
    await startReviewLoopLite(opts())
    await vi.waitFor(() => expect(latest()?.status).not.toBe('running'))

    const final = latest()!
    expect(final.status).toBe('error')
    expect(final.errorMessage).toBe('phase blew up')
    expect(h.phaseCalls).toHaveLength(1) // triage + fix never ran
    expect(final.rounds[0].phaseSlots.find((s) => s.phase === 'review')!.status).toBe('error')
  })

  it('cancels cleanly mid-phase, finalizing as cancelled', async () => {
    h.holdTab = 'review-loop:r1:review' // review hangs until aborted
    await startReviewLoopLite(opts())
    await vi.waitFor(() => expect(getReviewLoopLiteState('sess-1')?.status).toBe('running'))

    cancelReviewLoopLite('sess-1')
    await vi.waitFor(() => expect(latest()?.status).not.toBe('running'))

    const final = latest()!
    expect(final.status).toBe('cancelled')
    expect(final.stopReason).toBe('cancelled')
    // The held review terminal is recorded but marked skipped on cancel.
    expect(final.rounds[0].phaseSlots.find((s) => s.phase === 'review')!.status).toBe('skipped')
  })

  it('rejects a second concurrent loop for the same session', async () => {
    h.holdTab = 'review-loop:r1:review' // keep the first loop running
    await startReviewLoopLite(opts())
    await vi.waitFor(() => expect(getReviewLoopLiteState('sess-1')?.status).toBe('running'))

    await expect(startReviewLoopLite(opts())).rejects.toThrow(/already running/)

    cancelReviewLoopLite('sess-1') // clean up so the session doesn't leak
    await vi.waitFor(() => expect(latest()?.status).toBe('cancelled'))
  })
})
