import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReviewLoopState } from '../../../src/shared/types'

// Shared state + the git mock live in the hoisted block so the (hoisted)
// vi.mock factories can reference them without a TDZ error.
const h = vi.hoisted(() => {
  const s: any = {
    headlessCalls: [],
    spawnCalls: [],
    writes: [],
    killCalls: [],
    hookListeners: [],
    workerContextId: 'sess-1',
    // When true, spawning/pasting does NOT auto-fire a Stop, so the worker turn
    // hangs (used by the cancel test).
    holdWorker: false,
    sameSha: true,
    shaCounter: 0,
    dirty: false,
    failHeadless: false,
  }
  s.nextSha = () => (s.sameSha ? 'SHA-CONST' : `SHA-${s.shaCounter++}`)

  // Fire a Stop hook for the persistent worker tab to all current listeners,
  // simulating claude finishing its turn.
  s.fireStop = () => {
    for (const l of [...s.hookListeners]) {
      l({ contextId: s.workerContextId, tabId: 'review-loop:persistent', hookType: 'stop' })
    }
  }
  s.maybeFireStop = () => {
    if (!s.holdWorker) queueMicrotask(() => s.fireStop())
  }

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

// Review phase runs headlessly: record the call, stream a line, return output.
vi.mock('../../../src/main/services/review-phase.service', () => ({
  DEFAULT_PHASE_TIMEOUT_MS: 1000,
  runHeadlessPhase: vi.fn((opts: Record<string, any>) => {
    h.headlessCalls.push(opts)
    opts.onTranscript?.('▶ headless review line')
    if (h.failHeadless) {
      return Promise.resolve({ ok: false, terminalId: '', output: '', error: 'review blew up' })
    }
    return Promise.resolve({ ok: true, terminalId: '', output: 'REVIEW-OUTPUT' })
  }),
}))

// Terminal service: spawnTerminal starts the worker (and would fire its first
// Stop), writeTerminal pastes a follow-up prompt (and fires the next Stop).
vi.mock('../../../src/main/services/terminal.service', () => ({
  AUTO_PERMISSION_MODE_ARGS: [],
  spawnTerminal: vi.fn((...args: any[]) => {
    h.spawnCalls.push(args)
    h.workerContextId = args[9] // contextId param
    h.maybeFireStop()
    return 'term-persistent'
  }),
  writeTerminal: vi.fn((terminalId: string, data: string) => {
    h.writes.push({ terminalId, data })
    // A paste ends with the bracketed-paste close + Enter; treat a completed
    // paste as a submitted turn.
    if (data.includes('\x1b[201~')) h.maybeFireStop()
  }),
  killReviewLoopTerminals: vi.fn((sessionId: string) => {
    h.killCalls.push(sessionId)
    return 0
  }),
}))

vi.mock('../../../src/main/services/notification-server', () => ({
  onHookEvent: vi.fn((listener: (evt: any) => void) => {
    h.hookListeners.push(listener)
    return () => {
      const i = h.hookListeners.indexOf(listener)
      if (i >= 0) h.hookListeners.splice(i, 1)
    }
  }),
}))

vi.mock('../../../src/main/services/hook.service', () => ({
  writeClaudeHookSettings: vi.fn(),
}))
vi.mock('../../../src/main/services/permission-sync.service', () => ({
  seedPermissions: vi.fn(),
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
  startReviewLoopEfficient,
  setReviewLoopEfficientWindow,
  getReviewLoopEfficientState,
  cancelReviewLoopEfficient,
  wrapBracketedPaste,
  clampReview,
  buildTriagePrompt,
  buildFixPrompt,
} from '../../../src/main/services/review-loop-efficient.service'

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
  config: { enabled: true, variant: 'efficient' as const, maxIterations: 5, consecutiveCleanRounds: 1, headless: true },
  prNumber: 42,
  repoPath: '/repo',
  ...over,
})

beforeEach(() => {
  h.headlessCalls = []
  h.spawnCalls = []
  h.writes = []
  h.killCalls = []
  h.hookListeners = []
  h.workerContextId = 'sess-1'
  h.holdWorker = false
  h.sameSha = true
  h.shaCounter = 0
  h.dirty = false
  h.failHeadless = false
  sentStates.length = 0
  setReviewLoopEfficientWindow(fakeWindow)
})

describe('pure helpers', () => {
  it('wraps a prompt in bracketed-paste delimiters with a trailing Enter', () => {
    expect(wrapBracketedPaste('hello')).toBe('\x1b[200~hello\x1b[201~\r')
  })

  it('clamps an oversized review and notes the truncation', () => {
    const big = 'x'.repeat(60 * 1024)
    const out = clampReview(big)
    expect(out.length).toBeLessThan(big.length)
    expect(out).toContain('review truncated')
    expect(clampReview('small')).toBe('small') // small reviews pass through
  })

  it('builds a triage prompt that embeds the review and round, and forbids changes', () => {
    const p = buildTriagePrompt('feat/x', 'main', 3, 'REVIEW-OUTPUT')
    expect(p).toContain('Round 3')
    expect(p).toContain('REVIEW-OUTPUT')
    expect(p).toContain('full memory of earlier rounds')
    expect(p).toContain('Do not make any changes yet')
  })

  it('builds a fix prompt that commits and pushes to the branch', () => {
    expect(buildFixPrompt('feat/x')).toContain('push to origin/feat/x')
  })
})

describe('startReviewLoopEfficient', () => {
  it('runs a fresh headless review then triage + fix on the persistent worker, and converges', async () => {
    await startReviewLoopEfficient(opts())
    await vi.waitFor(() => expect(latest()?.status).not.toBe('running'))

    const final = latest()!
    expect(final.status).toBe('completed')
    expect(final.stopReason).toBe('converged')
    expect(final.iteration).toBe(1)
    expect(final.variant).toBe('efficient')

    // One fresh headless review.
    expect(h.headlessCalls).toHaveLength(1)
    // One persistent worker spawned for the first (triage) turn.
    expect(h.spawnCalls).toHaveLength(1)
    expect(final.persistentTerminalId).toBe('term-persistent')
    expect(final.persistentTabId).toBe('review-loop:persistent')

    // Round 1 triage is delivered via the spawn heredoc (commandString = arg 6).
    const spawnPrompt = h.spawnCalls[0][6] as string
    expect(spawnPrompt).toContain('Round 1')
    expect(spawnPrompt).toContain('REVIEW-OUTPUT')
    // It spawns on the persistent tab (arg 10) in auto mode (empty claude args, arg 11).
    expect(h.spawnCalls[0][10]).toBe('review-loop:persistent')
    expect(h.spawnCalls[0][11]).toEqual([])

    // The fix turn is pasted into the live REPL (bracketed paste).
    const fixPaste = h.writes.map((w: any) => w.data).join('')
    expect(fixPaste).toContain('\x1b[200~')
    expect(fixPaste).toContain('push to origin/feat/x')

    const slots = final.rounds[0].phaseSlots
    expect(slots.map((s) => s.status)).toEqual(['completed', 'completed', 'completed'])
    // Triage + fix share the persistent tab; only review has its own headless tab.
    expect(slots.find((s) => s.phase === 'triage')!.tabId).toBe('review-loop:persistent')
    expect(slots.find((s) => s.phase === 'fix')!.tabId).toBe('review-loop:persistent')
    expect(slots.find((s) => s.phase === 'review')!.transcript).toContain('▶ headless review line')
  })

  it('reuses the SAME worker across rounds — spawn once, paste thereafter', async () => {
    h.sameSha = false // HEAD advances every round → never converges
    await startReviewLoopEfficient(opts({ config: { enabled: true, variant: 'efficient', maxIterations: 2, consecutiveCleanRounds: 2, headless: true } }))
    await vi.waitFor(() => expect(latest()?.status).not.toBe('running'))

    const final = latest()!
    expect(final.stopReason).toBe('maxIterations')
    expect(final.iteration).toBe(2)

    expect(h.headlessCalls).toHaveLength(2) // a fresh review per round
    expect(h.spawnCalls).toHaveLength(1) // worker spawned only once, ever
    // round1: triage(spawn) + fix(paste); round2: triage(paste) + fix(paste) = 3 pastes
    const triageWrites = h.writes.filter((w: any) => w.data.includes('Round 2'))
    expect(triageWrites.length).toBeGreaterThan(0) // round-2 triage pasted into the live worker
  })

  it('falls back to the branch diff in the review prompt when there is no PR', async () => {
    await startReviewLoopEfficient(opts({ prNumber: undefined }))
    await vi.waitFor(() => expect(latest()?.status).not.toBe('running'))
    expect(h.headlessCalls[0].prompt).toContain('/review')
    expect(h.headlessCalls[0].prompt).toContain('DIFF-CONTENT')
  })

  it('finalizes as error when the review fails, never spawning the worker', async () => {
    h.failHeadless = true
    await startReviewLoopEfficient(opts())
    await vi.waitFor(() => expect(latest()?.status).not.toBe('running'))

    const final = latest()!
    expect(final.status).toBe('error')
    expect(final.errorMessage).toBe('review blew up')
    expect(h.spawnCalls).toHaveLength(0)
    expect(final.rounds[0].phaseSlots.find((s) => s.phase === 'review')!.status).toBe('error')
  })

  it('cancels cleanly mid-worker-turn, finalizing as cancelled', async () => {
    h.holdWorker = true // the worker turn never fires Stop on its own
    await startReviewLoopEfficient(opts())
    await vi.waitFor(() => expect(getReviewLoopEfficientState('sess-1')?.status).toBe('running'))

    cancelReviewLoopEfficient('sess-1')
    await vi.waitFor(() => expect(latest()?.status).not.toBe('running'))

    const final = latest()!
    expect(final.status).toBe('cancelled')
    expect(final.stopReason).toBe('cancelled')
    expect(final.rounds[0].phaseSlots.find((s) => s.phase === 'triage')!.status).toBe('skipped')
  })

  it('rejects a second concurrent loop for the same session', async () => {
    h.holdWorker = true // keep the first loop running
    await startReviewLoopEfficient(opts())
    await vi.waitFor(() => expect(getReviewLoopEfficientState('sess-1')?.status).toBe('running'))

    await expect(startReviewLoopEfficient(opts())).rejects.toThrow(/already running/)

    cancelReviewLoopEfficient('sess-1')
    await vi.waitFor(() => expect(latest()?.status).toBe('cancelled'))
  })

  it('sweeps stale review-loop terminals on start and on finalize', async () => {
    await startReviewLoopEfficient(opts())
    await vi.waitFor(() => expect(latest()?.status).not.toBe('running'))
    expect(h.killCalls).toEqual(['sess-1', 'sess-1'])
  })
})
