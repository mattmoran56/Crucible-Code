/**
 * Integration test for session permission mode.
 *
 * Exercises the FULL "open a Claude Code session" path end-to-end inside the
 * main process — from the IPC entry point a click/remote-invoke hits
 * (`IPC.TERMINAL_SPAWN`), through the REAL terminal IPC handler and the REAL
 * terminal service (spawnTerminal → spawnPty → buildClaudeCommand), down to the
 * actual shell command handed to node-pty. Only the leaves are mocked: node-pty
 * (capture the launched command), electron, the store, and the hook/permission
 * side-effects.
 *
 * The assertion that matters: a freshly-opened session launches plain `claude`
 * with NO `--permission-mode`, so it inherits the user's configured default
 * (`auto`) — it is NOT forced into `acceptEdits`, and never bypasses.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Capture every node-pty spawn so we can inspect the real launched command.
const ptyState = vi.hoisted(() => ({
  spawns: [] as Array<{ command: string; args: string[]; env?: Record<string, string> }>,
}))

function makeFakePty() {
  return {
    onData: vi.fn(),
    onExit: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    pid: 4242,
  }
}

vi.mock('node-pty', () => ({
  spawn: vi.fn((command: string, args: string[], opts?: { env?: Record<string, string> }) => {
    ptyState.spawns.push({ command, args, env: opts?.env })
    return makeFakePty()
  }),
}))

// Minimal electron surface: ipcMain.handle (so `handle` registers) + nothing else.
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: class {},
}))

vi.mock('electron-store', () => ({
  default: class {
    get() {
      return {}
    }
    set() {}
    delete() {}
  },
}))

vi.mock('../../../src/main/store-path', () => ({ getStorePath: () => '/tmp' }))

vi.mock('../../../src/main/services/notification-server', () => ({
  handleHookEvent: vi.fn(),
  findContextById: vi.fn(),
}))

// Side-effects the IPC handler fires before spawning — irrelevant here.
vi.mock('../../../src/main/services/hook.service', () => ({
  writeClaudeHookSettings: vi.fn(),
}))

import { IPC } from '../../../src/shared/constants'
import { invokeHandler } from '../../../src/main/ipc/handle'
import { registerTerminalHandlers } from '../../../src/main/ipc/terminal.ipc'

const fakeWindow = {
  isDestroyed: () => false,
  webContents: { send: vi.fn() },
} as unknown as Electron.BrowserWindow

/** The shell body (`sh -lc '<body>'`) of the most recent spawn. */
function lastShellBody(): string {
  const last = ptyState.spawns.at(-1)
  if (!last) throw new Error('no pty spawned')
  // spawnPty launches the shell with ['-l', '-c', <body>].
  expect(last.args.slice(0, 2)).toEqual(['-l', '-c'])
  return last.args[2]
}

beforeEach(() => {
  ptyState.spawns = []
  registerTerminalHandlers(fakeWindow)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('opening a Claude Code session (TERMINAL_SPAWN)', () => {
  it('launches a `claude` session in the auto default mode — no --permission-mode, never acceptEdits/bypass', async () => {
    // sessionId, cwd, mode, theme, configDir, repoPath, resume, contextId, tabId
    await invokeHandler(IPC.TERMINAL_SPAWN, [
      'sess-auto',
      '/wt/sess-auto',
      'claude',
      'dark',
      undefined,
      undefined,
      false,
      'sess-auto',
      'agent',
    ])

    expect(ptyState.spawns).toHaveLength(1)
    const body = lastShellBody()

    // The decisive assertion: opens in auto (inherited default), NOT acceptEdits.
    expect(body).toBe('claude')
    expect(body).not.toContain('--permission-mode')
    expect(body).not.toContain('acceptEdits')
    expect(body).not.toContain('bypassPermissions')
    expect(body).not.toContain('--dangerously-skip-permissions')
  })

  it('still launches `claude` (no permission flag) when resuming a session', async () => {
    await invokeHandler(IPC.TERMINAL_SPAWN, [
      'sess-resume',
      '/wt/sess-resume',
      'claude',
      'dark',
      undefined,
      undefined,
      true, // resume
      'sess-resume',
      'agent',
    ])

    const body = lastShellBody()
    expect(body).toBe('claude --resume')
    expect(body).not.toContain('--permission-mode')
    expect(body).not.toContain('acceptEdits')
  })

  it('does not pass any claude permission args for a plain shell terminal', async () => {
    await invokeHandler(IPC.TERMINAL_SPAWN, [
      'sess-shell',
      '/wt/sess-shell',
      'shell',
      'dark',
      undefined,
      undefined,
      false,
      'sess-shell',
      'shell',
    ])

    // A shell terminal just launches the login shell — no claude command, no
    // permission args of any kind.
    const last = ptyState.spawns.at(-1)!
    const launched = [last.command, ...last.args].join(' ')
    expect(launched).not.toContain('--permission-mode')
    expect(launched).not.toContain('claude')
  })
})

describe('a session opened while the app itself runs inside a Claude Code session', () => {
  const markers = { CLAUDECODE: '1', CLAUDE_CODE_CHILD_SESSION: '1', CLAUDE_CODE_SESSION_ID: 'parent', CLAUDE_PID: '1' }
  beforeEach(() => Object.assign(process.env, markers))
  afterEach(() => {
    for (const key of Object.keys(markers)) delete process.env[key]
  })

  it("does not hand the parent's child-session markers to claude (they switch transcript saving off)", async () => {
    await invokeHandler(IPC.TERMINAL_SPAWN, ['sess-nested', '/wt/sess-nested', 'claude', 'dark', undefined, undefined, false, 'sess-nested', 'agent'])
    const env = ptyState.spawns.at(-1)!.env!
    for (const key of Object.keys(markers)) expect(env).not.toHaveProperty(key)
    expect(env.CRUCIBLE_CONTEXT_ID).toBe('sess-nested')
  })
})
