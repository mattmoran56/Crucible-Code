import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Shared, hoisted mock state. terminal.service / notification-server etc. are
// fully replaced so no electron / node-pty is loaded by this suite.
const h = vi.hoisted(() => ({
  spawnCalls: [] as unknown[][],
  killCalls: [] as string[],
  hookListeners: [] as Array<(evt: { contextId: string; tabId: string; hookType: string }) => void>,
  hookSettingsCalls: [] as unknown[][],
  seedCalls: [] as unknown[][],
  headlessRuns: [] as Array<Record<string, any>>,
  buffer: '',
  spawnId: 'term-1',
}))

vi.mock('../../../src/main/services/terminal.service', () => ({
  // Mirror the real constant: empty, so sessions inherit the user's default
  // (auto) mode rather than being forced into acceptEdits.
  AUTO_PERMISSION_MODE_ARGS: [],
  spawnTerminal: (...args: unknown[]) => {
    h.spawnCalls.push(args)
    return h.spawnId
  },
  killTerminal: (id: string) => {
    h.killCalls.push(id)
  },
  getTerminalBuffer: () => h.buffer,
}))

vi.mock('../../../src/main/services/notification-server', () => ({
  onHookEvent: (listener: (evt: { contextId: string; tabId: string; hookType: string }) => void) => {
    h.hookListeners.push(listener)
    return () => {
      h.hookListeners = h.hookListeners.filter((l) => l !== listener)
    }
  },
}))

vi.mock('../../../src/main/services/hook.service', () => ({
  writeClaudeHookSettings: (...args: unknown[]) => {
    h.hookSettingsCalls.push(args)
  },
}))

vi.mock('../../../src/main/services/permission-sync.service', () => ({
  seedPermissions: (...args: unknown[]) => {
    h.seedCalls.push(args)
  },
}))

vi.mock('../../../src/main/services/claude-headless.service', () => ({
  killChildTree: vi.fn(),
  runHeadlessClaude: vi.fn((opts: Record<string, any>) => {
    h.headlessRuns.push(opts)
    opts.onTranscript?.('line-a')
    opts.onTranscript?.('line-b')
    return Promise.resolve({
      ok: true,
      costUsd: 0,
      transcript: ['line-a', 'line-b'],
      exitCode: 0,
      signal: null,
    })
  }),
}))

import {
  runForegroundPhase,
  runHeadlessPhase,
  stripAnsi,
} from '../../../src/main/services/review-phase.service'

const fakeWindow = {} as unknown as Electron.BrowserWindow

function fireHook(evt: { contextId: string; tabId: string; hookType: string }): void {
  for (const l of [...h.hookListeners]) l(evt)
}

const baseOpts = () => ({
  window: fakeWindow,
  sessionId: 'sess-1',
  worktreePath: '/wt/sess-1',
  repoPath: '/repo',
  tabId: 'review-loop:r1:review',
  prompt: 'do the review',
})

beforeEach(() => {
  h.spawnCalls = []
  h.killCalls = []
  h.hookListeners = []
  h.hookSettingsCalls = []
  h.seedCalls = []
  h.headlessRuns = []
  h.buffer = ''
  h.spawnId = 'term-1'
})

afterEach(() => {
  vi.useRealTimers()
})

describe('stripAnsi', () => {
  it('removes colour + cursor escape sequences but keeps text', () => {
    const input = '\x1b[32mgreen\x1b[0m and \x1b[2K\x1b[1;5Hmoved'
    expect(stripAnsi(input)).toBe('green and moved')
  })

  it('is a no-op for plain text', () => {
    expect(stripAnsi('just text 123')).toBe('just text 123')
  })
})

describe('runForegroundPhase', () => {
  it('spawns an interactive claude terminal with the phase prompt + tab id', async () => {
    const p = runForegroundPhase(baseOpts())
    fireHook({ contextId: 'sess-1', tabId: 'review-loop:r1:review', hookType: 'stop' })
    await p

    expect(h.spawnCalls).toHaveLength(1)
    const args = h.spawnCalls[0]
    // spawnTerminal(window, sessionId, cwd, mode, theme, configDir, prompt, repoPath, resume, contextId, tabId, claudeArgs)
    expect(args[1]).toBe('sess-1')
    expect(args[2]).toBe('/wt/sess-1')
    expect(args[3]).toBe('claude')
    expect(args[6]).toBe('do the review')
    expect(args[9]).toBe('sess-1') // contextId routes the hook back
    expect(args[10]).toBe('review-loop:r1:review')
  })

  it('reports the spawned terminal id via onSpawn', async () => {
    const onSpawn = vi.fn()
    const p = runForegroundPhase({ ...baseOpts(), onSpawn })
    fireHook({ contextId: 'sess-1', tabId: 'review-loop:r1:review', hookType: 'stop' })
    await p
    expect(onSpawn).toHaveBeenCalledWith('term-1')
  })

  it('runs in the auto default mode (no explicit permission flag) when autoAcceptEdits is set — never acceptEdits or bypass', async () => {
    const p1 = runForegroundPhase({ ...baseOpts(), autoAcceptEdits: true })
    fireHook({ contextId: 'sess-1', tabId: 'review-loop:r1:review', hookType: 'stop' })
    await p1
    // Inherits the user's default (auto) mode: no --permission-mode at all, and
    // in particular never acceptEdits or bypass.
    const phaseArgs = h.spawnCalls[0][11] as string[]
    expect(phaseArgs).toEqual([])
    expect(phaseArgs).not.toContain('--permission-mode')
    expect(phaseArgs).not.toContain('acceptEdits')
    expect(phaseArgs).not.toContain('bypassPermissions')
    expect(phaseArgs).not.toContain('--dangerously-skip-permissions')

    h.spawnCalls = []
    const p2 = runForegroundPhase({ ...baseOpts(), autoAcceptEdits: false })
    fireHook({ contextId: 'sess-1', tabId: 'review-loop:r1:review', hookType: 'stop' })
    await p2
    expect(h.spawnCalls[0][11]).toBeUndefined()
  })

  it('writes hook settings and seeds permissions before spawning', async () => {
    const p = runForegroundPhase(baseOpts())
    fireHook({ contextId: 'sess-1', tabId: 'review-loop:r1:review', hookType: 'stop' })
    await p
    expect(h.hookSettingsCalls).toHaveLength(1)
    expect(h.hookSettingsCalls[0][0]).toBe('/wt/sess-1')
    expect(h.seedCalls).toHaveLength(1)
    expect(h.seedCalls[0]).toEqual(['/repo', '/wt/sess-1'])
  })

  it('resolves ok and freezes (kills) the terminal on a matching stop hook', async () => {
    h.buffer = '\x1b[32mfindings\x1b[0m here'
    const p = runForegroundPhase(baseOpts())
    fireHook({ contextId: 'sess-1', tabId: 'review-loop:r1:review', hookType: 'stop' })
    const res = await p
    expect(res.ok).toBe(true)
    expect(res.terminalId).toBe('term-1')
    expect(res.output).toBe('findings here') // ANSI-stripped buffer
    expect(h.killCalls).toEqual(['term-1']) // frozen
  })

  it('ignores hook events for other tabs, contexts, or non-stop types', async () => {
    vi.useFakeTimers()
    const res = runForegroundPhase({ ...baseOpts(), timeoutMs: 1000 })
    fireHook({ contextId: 'sess-1', tabId: 'review-loop:r1:triage', hookType: 'stop' }) // wrong tab
    fireHook({ contextId: 'other', tabId: 'review-loop:r1:review', hookType: 'stop' }) // wrong ctx
    fireHook({ contextId: 'sess-1', tabId: 'review-loop:r1:review', hookType: 'notification' }) // wrong type
    expect(h.killCalls).toHaveLength(0) // not resolved yet
    await vi.advanceTimersByTimeAsync(1000)
    const settled = await res
    expect(settled.ok).toBe(false) // only the timeout settled it
    expect(settled.error).toMatch(/timed out/)
  })

  it('resolves not-ok and freezes the terminal on timeout', async () => {
    vi.useFakeTimers()
    const p = runForegroundPhase({ ...baseOpts(), timeoutMs: 60_000 })
    await vi.advanceTimersByTimeAsync(60_000)
    const res = await p
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/timed out/)
    expect(h.killCalls).toEqual(['term-1'])
  })

  it('resolves cancelled and freezes when the signal aborts mid-run', async () => {
    const ctrl = new AbortController()
    const p = runForegroundPhase({ ...baseOpts(), signal: ctrl.signal })
    ctrl.abort()
    const res = await p
    expect(res.ok).toBe(false)
    expect(res.error).toBe('cancelled')
    expect(h.killCalls).toEqual(['term-1'])
  })

  it('resolves cancelled immediately if the signal is already aborted', async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    const res = await runForegroundPhase({ ...baseOpts(), signal: ctrl.signal })
    expect(res.ok).toBe(false)
    expect(res.error).toBe('cancelled')
  })

  it('only settles once — a stop after timeout does not double-resolve', async () => {
    vi.useFakeTimers()
    const p = runForegroundPhase({ ...baseOpts(), timeoutMs: 1000 })
    await vi.advanceTimersByTimeAsync(1000)
    await p
    fireHook({ contextId: 'sess-1', tabId: 'review-loop:r1:review', hookType: 'stop' })
    expect(h.killCalls).toEqual(['term-1']) // still only one freeze
  })
})

describe('runHeadlessPhase', () => {
  it('seeds hooks + permissions, streams the transcript, and joins the output', async () => {
    const streamed: string[] = []
    const res = await runHeadlessPhase({
      sessionId: 'sess-1',
      worktreePath: '/wt/sess-1',
      repoPath: '/repo',
      prompt: 'review it',
      onTranscript: (l) => streamed.push(l),
    })

    expect(res.ok).toBe(true)
    expect(res.terminalId).toBe('') // no PTY in headless mode
    expect(res.output).toBe('line-a\nline-b')
    expect(streamed).toEqual(['line-a', 'line-b'])
    // Same worktree prep as the foreground path.
    expect(h.hookSettingsCalls).toHaveLength(1)
    expect(h.seedCalls).toHaveLength(1)
    expect(h.headlessRuns[0].cwd).toBe('/wt/sess-1')
    expect(h.headlessRuns[0].prompt).toBe('review it')
  })

  it('resolves cancelled without spawning if the signal is already aborted', async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    const res = await runHeadlessPhase({
      sessionId: 'sess-1',
      worktreePath: '/wt/sess-1',
      prompt: 'x',
      signal: ctrl.signal,
    })
    expect(res.ok).toBe(false)
    expect(res.error).toBe('cancelled')
    expect(h.headlessRuns).toHaveLength(0)
  })
})
