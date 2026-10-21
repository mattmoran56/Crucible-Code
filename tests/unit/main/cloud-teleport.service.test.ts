// The teleport run: progress and prompts read off the `claude --teleport`
// PTY, completion detected from the teleported transcript on disk, then the
// REPL is closed and the run reports the local Claude session id.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  watchers: new Map<string, { onData?: (d: string) => void; onExit?: (c: number) => void }>(),
  spawnTerminal: vi.fn((..._args: unknown[]) => 'term-t'),
  killTerminalsForTab: vi.fn(),
  writeTerminal: vi.fn(),
  killTerminal: vi.fn(),
  transcript: null as null | { id: string; path: string; size: number; mtime: number; marked: boolean },
}))

vi.mock('../../../src/main/services/terminal.service', () => ({
  AUTO_PERMISSION_MODE_ARGS: [],
  shellQuote: (a: string) => a,
  spawnTerminal: h.spawnTerminal,
  killTerminalsForTab: h.killTerminalsForTab,
  writeTerminal: h.writeTerminal,
  killTerminal: h.killTerminal,
  watchTerminal: (id: string, w: { onData?: (d: string) => void; onExit?: (c: number) => void }) => {
    h.watchers.set(id, w)
    return () => h.watchers.delete(id)
  },
}))
vi.mock('../../../src/main/services/cloud-session.service', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../src/main/services/cloud-session.service')>()
  return { ...real, findTeleportTranscript: vi.fn(async () => h.transcript) }
})

import {
  TELEPORT_EXIT_WAIT_MS,
  TELEPORT_POLL_MS,
  _resetTeleportRuns,
  awaitingInputIn,
  finishTeleport,
  getTeleportState,
  progressStepsIn,
  sessionResumedIn,
  startTeleport,
} from '../../../src/main/services/cloud-teleport.service'
import { IPC } from '../../../src/shared/constants'
import type { CloudTeleportState } from '../../../src/shared/types'

const sent: CloudTeleportState[] = []
const win = { isDestroyed: () => false, webContents: { send: (ch: string, s: CloudTeleportState) => ch === IPC.CLOUD_SESSION_TELEPORT_EVENT && sent.push(s) } } as any
const opts = { sessionId: 's1', projectId: 'p1', worktreePath: '/wt/feat', cloudSessionId: 'session_01abc', configDir: '/cfg' }

const pty = () => h.watchers.get('term-t')!
const tick = async (ms = TELEPORT_POLL_MS) => {
  await vi.advanceTimersByTimeAsync(ms)
}

beforeEach(() => {
  vi.useFakeTimers()
  sent.length = 0
  h.watchers.clear()
  h.transcript = null
  vi.clearAllMocks()
})
afterEach(() => {
  _resetTeleportRuns()
  vi.useRealTimers()
})

describe('reading the teleport PTY', () => {
  it('finds the CLI progress steps through ANSI noise, in CLI order', () => {
    const out = '\x1b[2K\x1b[32m✓\x1b[0m Fetching session logs\r\n\x1b[1mValidating session\x1b[0m…\r\n'
    expect(progressStepsIn(out)).toEqual(['Validating session', 'Fetching session logs'])
    expect(sessionResumedIn(out)).toBe(false)
    expect(sessionResumedIn('⎿ Session resumed')).toBe(true)
  })

  it('treats a prompt as pending until progress follows it', () => {
    expect(awaitingInputIn('Validating session\nWould you like to stash these changes and continue with teleport?')).toBe(true)
    expect(awaitingInputIn('Do you trust the files in this folder?\n❯ 1. Yes, proceed')).toBe(true)
    expect(awaitingInputIn('Would you like to stash these changes?\n…\nChecking out branch')).toBe(false)
    expect(awaitingInputIn('Fetching session logs')).toBe(false)
  })
})

describe('a teleport run', () => {
  it('spawns `claude --teleport <id>` in the Agent tab PTY with no permission flags', () => {
    const state = startTeleport(win, opts)
    expect(state).toMatchObject({ sessionId: 's1', projectId: 'p1', terminalId: 'term-t', status: 'running', steps: [] })
    expect(h.killTerminalsForTab).toHaveBeenCalledWith('s1', 'agent')
    const command = h.spawnTerminal.mock.calls[0][6] as string
    expect(command).toBe('claude --teleport session_01abc')
    expect(command).not.toMatch(/permission|dangerously/)
    expect(getTeleportState('s1')?.terminalId).toBe('term-t')
  })

  it('reports steps, then closes the REPL once the marked transcript stops growing, and is done with its id', async () => {
    startTeleport(win, opts)
    pty().onData!('Validating session\r\nFetching session logs\r\n')
    expect(sent.at(-1)).toMatchObject({ status: 'running', steps: ['Validating session', 'Fetching session logs'] })

    h.transcript = { id: 'local-1', path: '/p/local-1.jsonl', size: 100, mtime: 1, marked: true }
    await tick()
    expect(h.writeTerminal).not.toHaveBeenCalled() // still growing? first sighting only
    h.transcript = { ...h.transcript, size: 200 }
    await tick()
    expect(h.writeTerminal).not.toHaveBeenCalled()
    await tick() // same size twice: stable
    expect(getTeleportState('s1')).toMatchObject({ status: 'finishing', claudeSessionId: 'local-1' })
    expect(h.writeTerminal).toHaveBeenCalledWith('term-t', '\x03')

    pty().onExit!(0)
    await tick(0)
    expect(sent.at(-1)).toMatchObject({ status: 'done', claudeSessionId: 'local-1' })
  })

  it('kills a REPL that ignores Ctrl-C', async () => {
    startTeleport(win, opts)
    h.transcript = { id: 'local-1', path: '/p', size: 5, mtime: 1, marked: true }
    await tick()
    await tick()
    await tick(TELEPORT_EXIT_WAIT_MS)
    expect(h.killTerminal).toHaveBeenCalledWith('term-t')
  })

  it('does not trust an unmarked transcript until the CLI said the session resumed', async () => {
    startTeleport(win, opts)
    h.transcript = { id: 'other', path: '/p', size: 5, mtime: 1, marked: false }
    await tick()
    await tick()
    await tick()
    expect(getTeleportState('s1')?.status).toBe('running')
    pty().onData!('Session resumed\r\n')
    await tick()
    await tick()
    expect(getTeleportState('s1')).toMatchObject({ status: 'finishing', claudeSessionId: 'other' })
  })

  it('goes to needs-input on a CLI prompt, and back to running once it moves on', () => {
    startTeleport(win, opts)
    pty().onData!('Validating session\r\nWould you like to stash these changes and continue with teleport?\r\n')
    expect(getTeleportState('s1')?.status).toBe('needs-input')
    pty().onData!('Checking out branch\r\n')
    expect(getTeleportState('s1')?.status).toBe('running')
  })

  it('fails with the CLI output tail when the PTY exits before the conversation is local', async () => {
    startTeleport(win, opts)
    pty().onData!('Error: You must run claude --teleport session_01abc from a checkout of acme/web.\r\n')
    pty().onExit!(1)
    await tick(0)
    const last = sent.at(-1)!
    expect(last.status).toBe('failed')
    expect(last.error).toMatch(/exit 1/)
    expect(last.error).toMatch(/from a checkout of acme\/web/)
  })

  it('finishTeleport closes the REPL on request and settles to done with whatever transcript is there', async () => {
    startTeleport(win, opts)
    h.transcript = { id: 'local-9', path: '/p', size: 5, mtime: 1, marked: false }
    expect(finishTeleport('s1')?.status).toBe('finishing')
    expect(h.writeTerminal).toHaveBeenCalledWith('term-t', '\x03')
    pty().onExit!(0)
    await tick(0)
    expect(getTeleportState('s1')).toMatchObject({ status: 'done', claudeSessionId: 'local-9' })
  })
})
