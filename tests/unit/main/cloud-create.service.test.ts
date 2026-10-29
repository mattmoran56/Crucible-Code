import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const state = {
    gitCalls: [] as Array<{ args: string[]; cwd: string }>,
    pushErr: null as Error | null,
    spawns: [] as Array<{ sessionId: string; cwd: string; mode: string; configDir?: string; command: string; tabId?: string }>,
    watchers: new Map<string, { onData?: (d: string) => void; onExit?: (c: number) => void }>(),
    counter: 0,
    sent: [] as Array<{ channel: string; payload: any }>,
  }
  return { state }
})

vi.mock('node:child_process', () => {
  const execFile = (_f: string, args: string[], opts: { cwd: string }, cb: (e: Error | null, o: string, er: string) => void) => {
    h.state.gitCalls.push({ args, cwd: opts.cwd })
    setTimeout(() => cb(h.state.pushErr, '', h.state.pushErr ? 'rejected' : ''), 0)
  }
  const spawn = () => {
    throw new Error('no headless claude in the create flow')
  }
  return { execFile, spawn, default: { execFile, spawn } }
})

vi.mock('../../../src/main/services/terminal.service', () => ({
  AUTO_PERMISSION_MODE_ARGS: [],
  shellQuote: (a: string) => (/^[A-Za-z0-9_\-/=:.,@+]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`),
  killTerminalsForTab: vi.fn(() => 0),
  spawnTerminal: (
    _w: unknown,
    sessionId: string,
    cwd: string,
    mode: string,
    _theme: string,
    configDir: string | undefined,
    command: string,
    _repo?: string,
    _resume?: boolean,
    _ctx?: string,
    tabId?: string
  ) => {
    h.state.spawns.push({ sessionId, cwd, mode, configDir, command, tabId })
    return `term-${++h.state.counter}`
  },
  watchTerminal: (id: string, w: { onData?: (d: string) => void; onExit?: (c: number) => void }) => {
    h.state.watchers.set(id, w)
    return () => h.state.watchers.delete(id)
  },
}))

import {
  _resetCloudCreateRuns,
  getCloudCreateState,
  startCloudCreate,
} from '../../../src/main/services/cloud-create.service'
import { IPC } from '../../../src/shared/constants'

const win = {
  isDestroyed: () => false,
  webContents: { send: (channel: string, payload: unknown) => h.state.sent.push({ channel, payload }) },
} as any

const opts = {
  sessionId: 'app-1',
  projectId: 'p1',
  worktreePath: '/wt/fix',
  branch: 'session/fix',
  task: 'fix the login bug',
  configDir: '/cfg',
}
const ID = 'session_01AbCdEfGhIjKl'

const pty = (id: string) => h.state.watchers.get(id)!

beforeEach(() => {
  _resetCloudCreateRuns()
  h.state.gitCalls = []
  h.state.pushErr = null
  h.state.spawns = []
  h.state.watchers.clear()
  h.state.counter = 0
  h.state.sent = []
})

describe('startCloudCreate', () => {
  it('pushes the branch, then runs the interactive claude --cloud in the Agent tab PTY', async () => {
    const state = await startCloudCreate(win, opts)
    expect(h.state.gitCalls[0]).toEqual({ args: ['push', '-u', 'origin', 'session/fix'], cwd: '/wt/fix' })
    expect(state).toMatchObject({ sessionId: 'app-1', projectId: 'p1', terminalId: 'term-1', status: 'running', attached: true })
    const spawn = h.state.spawns[0]
    expect(spawn).toMatchObject({ sessionId: 'app-1', cwd: '/wt/fix', mode: 'command', configDir: '/cfg', tabId: 'agent' })
    // Holds for the kickoff (claude.ai connectors), then the branch instruction and task.
    expect(spawn.command.startsWith("claude --cloud 'Do not start on this task yet.")).toBe(true)
    expect(spawn.command).toContain('Work on the git branch')
    expect(spawn.command).toContain('fix the login bug')
    expect(spawn.command.endsWith(' --on-branch session/fix')).toBe(true)
    for (const bad of [' -p ', '--print', '--output-format', '--permission-mode', '--dangerously-skip-permissions']) {
      expect(spawn.command).not.toContain(bad)
    }
  })

  it('orchestrator: no --on-branch pin, and the task lets it move between branches', async () => {
    await startCloudCreate(win, { ...opts, mode: 'orchestrator' })
    expect(h.state.gitCalls[0]).toEqual({ args: ['push', '-u', 'origin', 'session/fix'], cwd: '/wt/fix' })
    const spawn = h.state.spawns[0]
    expect(spawn.command.startsWith("claude --cloud 'Do not start on this task yet.")).toBe(true)
    expect(spawn.command).toContain('You are an orchestrator session')
    expect(spawn.command).toContain('fix the login bug')
    expect(spawn.command).not.toContain('--on-branch')
    expect(spawn.command).not.toContain('do not create or push to any other branch')
  })

  it('pending → created: reports the session as soon as the CLI prints it, CLI still attached', async () => {
    await startCloudCreate(win, opts)
    pty('term-1').onData!('Setting up remote session…\r\n\x1b[32m✓\x1b[0m Created cloud session\r\n')
    expect(getCloudCreateState('app-1')?.status).toBe('running')
    expect(h.state.sent).toHaveLength(0)
    pty('term-1').onData!(`Cloud session active · code here or at https://claude.ai/code/${ID}?from=cli&m=0\r\n`)
    const created = getCloudCreateState('app-1')!
    expect(created).toMatchObject({
      status: 'created',
      attached: true,
      result: { sessionId: ID, url: `https://claude.ai/code/${ID}`, branch: 'session/fix' },
    })
    expect(h.state.sent.at(-1)).toEqual({ channel: IPC.CLOUD_SESSION_CREATE_EVENT, payload: created })

    // Later exit only flips `attached`.
    pty('term-1').onExit!(0)
    expect(getCloudCreateState('app-1')).toMatchObject({ status: 'created', attached: false })
  })

  it('finds an id that only arrived in the last chunk before exit', async () => {
    await startCloudCreate(win, opts)
    const w = pty('term-1')
    w.onData!(`View: https://claude.ai/code/${ID}?from=cli&m=0\r\n`)
    w.onExit!(0)
    expect(getCloudCreateState('app-1')).toMatchObject({ status: 'created', attached: false })
  })

  it('failure: exits without an id → failed with the CLI output tail', async () => {
    await startCloudCreate(win, opts)
    pty('term-1').onData!('\x1b[31mError: Repository is not connected. Set up the GitHub integration at https://claude.ai/code\x1b[0m\r\n')
    pty('term-1').onExit!(1)
    const failed = getCloudCreateState('app-1')!
    expect(failed.status).toBe('failed')
    expect(failed.attached).toBe(false)
    expect(failed.error).toMatch(/exit 1/)
    expect(failed.error).toMatch(/Set up the GitHub integration/)
    expect(failed.mayExist).toBeUndefined()
    expect(h.state.sent.at(-1)?.payload.status).toBe('failed')
  })

  it('flags a create cancelled after the request was sent', async () => {
    await startCloudCreate(win, opts)
    pty('term-1').onData!('Cancelled after the create request was sent, so a cloud session may still have been created\r\n')
    pty('term-1').onExit!(130)
    expect(getCloudCreateState('app-1')).toMatchObject({ status: 'failed', mayExist: true })
  })

  it('retries once without --on-branch when the CLI does not know the flag', async () => {
    await startCloudCreate(win, opts)
    pty('term-1').onData!("error: unknown option '--on-branch'\r\n")
    pty('term-1').onExit!(1)
    expect(h.state.spawns).toHaveLength(2)
    expect(h.state.spawns[1].command).not.toContain('--on-branch')
    expect(h.state.spawns[1].command).toContain('session/fix') // still in the task text
    expect(getCloudCreateState('app-1')).toMatchObject({ terminalId: 'term-2', status: 'running' })
    // A second rejection is a plain failure, no third try.
    pty('term-2').onData!("error: unknown option '--on-branch'\r\n")
    pty('term-2').onExit!(1)
    expect(h.state.spawns).toHaveLength(2)
    expect(getCloudCreateState('app-1')?.status).toBe('failed')
  })

  it('a failed push fails the run without starting claude', async () => {
    h.state.pushErr = new Error('denied')
    const state = await startCloudCreate(win, opts)
    expect(state.status).toBe('failed')
    expect(state.error).toMatch(/Could not push session\/fix/)
    expect(h.state.spawns).toHaveLength(0)
  })

  it('refuses an empty task or a bad branch before pushing anything', async () => {
    await expect(startCloudCreate(win, { ...opts, task: '  ' })).rejects.toThrow(/task/)
    await expect(startCloudCreate(win, { ...opts, branch: '--force' })).rejects.toThrow(/Invalid branch name/)
    expect(h.state.gitCalls).toHaveLength(0)
  })

  it('a retry replaces the earlier run; output from the old PTY is ignored', async () => {
    await startCloudCreate(win, opts)
    pty('term-1').onExit!(1)
    expect(getCloudCreateState('app-1')?.status).toBe('failed')
    await startCloudCreate(win, opts)
    expect(getCloudCreateState('app-1')).toMatchObject({ terminalId: 'term-2', status: 'running', error: undefined })
  })
})
