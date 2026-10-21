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
  TELEPORT_STALL_MS,
  TELEPORT_TRANSCRIPT_WAIT_MS,
  _resetTeleportRuns,
  awaitingInputIn,
  finishTeleport,
  getTeleportState,
  progressStepsIn,
  replReadyIn,
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

/** One frame of the CLI's teleport progress view (2.1.306): every step is listed from the start. */
const frame = (current: number): string =>
  ['Validating session', 'Fetching session logs', 'Getting branch info', 'Checking out branch']
    .map((label, i) => `${i < current ? '\x1b[32m✔\x1b[39m' : i === current ? '\x1b[38;5;174m◐\x1b[39m' : '◯'} ${i === current ? `\x1b[1m${label}\x1b[22m` : label}`)
    .join('\r\n') + '\r\n'

describe('reading the teleport PTY', () => {
  it('counts only the steps drawn with a spinner or tick — the first frame lists all four', () => {
    // Root cause of the checklist jumping straight to "Loading the
    // conversation locally": every label is on screen from the first frame.
    expect(progressStepsIn(`\x1b[1m◐ Teleporting session…\x1b[22m\r\n${frame(0)}`)).toEqual(['Validating session'])
    expect(progressStepsIn(frame(2))).toEqual(['Validating session', 'Fetching session logs', 'Getting branch info'])
    // Cursor-forward between glyph and label still counts.
    expect(progressStepsIn('\x1b[32m✔\x1b[1CFetching session logs')).toEqual(['Validating session', 'Fetching session logs'])
  })

  it('knows the REPL is up from "Session resumed" or its prompt footer, even with words run together', () => {
    expect(replReadyIn(frame(3))).toBe(false)
    expect(replReadyIn('⎿ Session resumed')).toBe(true)
    expect(replReadyIn('⎿ Session\x1b[8Gresumed')).toBe(true)
    expect(replReadyIn('\x1b[2m? for shortcuts\x1b[22m')).toBe(true)
    expect(sessionResumedIn).toBe(replReadyIn)
    expect(progressStepsIn(`${frame(3)}⎿ Session resumed`)).toEqual([
      'Validating session',
      'Fetching session logs',
      'Getting branch info',
      'Checking out branch',
      'Session resumed',
    ])
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
    pty().onData!(frame(1))
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
    expect(getTeleportState('s1')).toMatchObject({ status: 'needs-input', waiting: 'prompt' })
    pty().onData!('Checking out branch\r\n')
    expect(getTeleportState('s1')?.status).toBe('running')
    expect(getTeleportState('s1')?.waiting).toBeUndefined()
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

  // Root cause (verified in 2.1.306): the REPL loads the teleported rows as
  // its restored conversation and its transcript recorder skips restored
  // messages, so nothing reaches disk until the conversation changes. The run
  // used to wait on the transcript forever ("Loading the conversation
  // locally" spinning). Now: REPL up + no transcript → hand over to the user.
  it('hands over to the terminal when the REPL is up but Claude has saved no transcript', async () => {
    startTeleport(win, opts)
    pty().onData!(`${frame(3)}\x1b[2J⎿ Session resumed\r\n❯ \r\n? for shortcuts`)
    expect(getTeleportState('s1')).toMatchObject({ status: 'running' })
    expect(getTeleportState('s1')?.steps).toContain('Session resumed')
    await tick(TELEPORT_TRANSCRIPT_WAIT_MS + TELEPORT_POLL_MS)
    expect(getTeleportState('s1')).toMatchObject({ status: 'needs-input', waiting: 'first-message' })
    expect(h.writeTerminal).not.toHaveBeenCalled()
  })

  it('never closes a handed-over REPL on its own; records the transcript id once one is saved', async () => {
    startTeleport(win, opts)
    pty().onData!('⎿ Session resumed\r\n')
    await tick(TELEPORT_TRANSCRIPT_WAIT_MS + TELEPORT_POLL_MS)
    // The user sends a message; Claude now writes the whole conversation.
    h.transcript = { id: 'local-7', path: '/p', size: 900, mtime: 1, marked: true }
    await tick()
    await tick()
    await tick()
    expect(getTeleportState('s1')).toMatchObject({ status: 'needs-input', waiting: 'first-message', claudeSessionId: 'local-7' })
    expect(h.writeTerminal).not.toHaveBeenCalled()
    // A permission prompt inside the REPL, then it moves on: still handed over.
    pty().onData!('Do you want to proceed?\r\n❯ 1. Yes\r\n')
    expect(getTeleportState('s1')?.waiting).toBe('prompt')
    pty().onData!('⎿ Session resumed\r\n? for shortcuts')
    expect(getTeleportState('s1')?.waiting).toBe('first-message')
    await tick()
    expect(h.writeTerminal).not.toHaveBeenCalled()
    // "Open in Agent view".
    finishTeleport('s1')
    expect(h.writeTerminal).toHaveBeenCalledWith('term-t', '\x03')
    pty().onExit!(0)
    await tick(0)
    expect(sent.at(-1)).toMatchObject({ status: 'done', claudeSessionId: 'local-7' })
  })

  it('times out to the terminal when nothing moves, and Cancel teleport then hands over with no id', async () => {
    startTeleport(win, opts)
    pty().onData!(frame(1))
    await tick(TELEPORT_STALL_MS + TELEPORT_POLL_MS)
    expect(getTeleportState('s1')).toMatchObject({ status: 'needs-input', waiting: 'timeout' })
    finishTeleport('s1')
    pty().onExit!(130)
    await tick(0)
    const last = sent.at(-1)!
    expect(last.status).toBe('done')
    expect(last.claudeSessionId).toBeUndefined()
  })

  it('clears a timeout once the CLI moves on', async () => {
    startTeleport(win, opts)
    await tick(TELEPORT_STALL_MS + TELEPORT_POLL_MS)
    expect(getTeleportState('s1')?.waiting).toBe('timeout')
    pty().onData!(frame(2))
    expect(getTeleportState('s1')).toMatchObject({ status: 'running' })
  })
})
