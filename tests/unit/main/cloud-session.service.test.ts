import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  type Child = EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => void }
  const state = {
    spawnCalls: [] as Array<{ file: string; args: string[]; opts: any }>,
    gitCalls: [] as Array<{ args: string[]; cwd: string }>,
    /** What the next claude child prints and how it exits. */
    claudeOut: { stdout: '', stderr: '', code: 0 as number | null },
    /** Per-call outputs, consumed first; falls back to claudeOut. */
    claudeOutQueue: [] as Array<{ stdout: string; stderr: string; code: number | null }>,
    /** git responses keyed by first arg. */
    gitResult: {} as Record<string, { err?: Error; stdout?: string; stderr?: string }>,
  }
  const makeChild = (): Child => {
    const child = new EventEmitter() as Child
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.kill = () => {}
    return child
  }
  return { state, makeChild }
})

vi.mock('node:child_process', () => {
  const spawn = (file: string, args: string[], opts: unknown) => {
    h.state.spawnCalls.push({ file, args, opts })
    const child = h.makeChild()
    const out = h.state.claudeOutQueue.shift() ?? h.state.claudeOut
    setTimeout(() => {
      if (out.stdout) child.stdout.emit('data', Buffer.from(out.stdout))
      if (out.stderr) child.stderr.emit('data', Buffer.from(out.stderr))
      child.emit('close', out.code)
    }, 0)
    return child
  }
  const execFile = (_file: string, args: string[], opts: { cwd: string }, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
    h.state.gitCalls.push({ args, cwd: opts.cwd })
    const r = h.state.gitResult[args[0]] ?? {}
    setTimeout(() => cb(r.err ?? null, r.stdout ?? '', r.stderr ?? ''), 0)
  }
  return { spawn, execFile, default: { spawn, execFile } }
})

vi.mock('../../../src/main/services/terminal.service', () => ({
  AUTO_PERMISSION_MODE_ARGS: [],
  shellQuote: (a: string) => (/^[A-Za-z0-9_\-/=:.,@+]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`),
}))

import {
  claudeShellCommand,
  cloudStartArgv,
  findCloudSessionInOutput,
  mayHaveCreatedSession,
  stripAnsi,
  summarizeCreateFailure,
  cloudEnv,
  cloudSendArgv,
  discoverTeleportedSession,
  findTeleportTranscript,
  encodeProjectDir,
  isUnknownOnBranchError,
  parseCloudResult,
  parsePorcelain,
  sendCloudMessage,
  teleportArgv,
  withBranchInstruction,
  worktreeDirtyFiles,
} from '../../../src/main/services/cloud-session.service'

const FORBIDDEN = ['--dangerously-skip-permissions', '--permission-mode', 'acceptEdits', 'bypassPermissions']
const assertNoPermissionFlags = (argv: string[]) => {
  for (const flag of FORBIDDEN) expect(argv).not.toContain(flag)
}

beforeEach(() => {
  h.state.spawnCalls = []
  h.state.gitCalls = []
  h.state.claudeOut = { stdout: '', stderr: '', code: 0 }
  h.state.claudeOutQueue = []
  h.state.gitResult = {}
})

describe('argv builders', () => {
  it('start: claude --cloud <task> — interactive, never -p, no permission flags', () => {
    const argv = cloudStartArgv('  fix the login bug  ')
    expect(argv).toEqual(['--cloud', 'fix the login bug'])
    expect(argv).not.toContain('-p')
    expect(argv).not.toContain('--print')
    expect(argv).not.toContain('--output-format')
    assertNoPermissionFlags(argv)
  })

  it('start: --on-branch <branch> when a branch is given', () => {
    const argv = cloudStartArgv('go', 'session/feat')
    expect(argv).toEqual(['--cloud', 'go', '--on-branch', 'session/feat'])
    assertNoPermissionFlags(argv)
    expect(() => cloudStartArgv('go', '--force')).toThrow(/Invalid branch name/)
    expect(() => cloudStartArgv('go', '')).toThrow(/Invalid branch name/)
    expect(() => cloudStartArgv('   ')).toThrow(/task/)
  })

  it('start: a task starting with "-" cannot be read as a flag', () => {
    expect(cloudStartArgv('--help me')[1]).toBe(' --help me')
  })

  it('start: the task is single-quoted for the PTY shell, so it is never interpreted', () => {
    const task = "it's $(rm -rf ~) `x` \"q\"\nline two; echo $HOME"
    const cmd = claudeShellCommand(cloudStartArgv(task, 'session/x'))
    expect(cmd).toBe(`claude --cloud '${task.replace(/'/g, `'\\''`)}' --on-branch session/x`)
  })

  it('send: -p <msg> --cloud <id> --output-format json', () => {
    const argv = cloudSendArgv('session_01abc', 'and add tests')
    expect(argv).toEqual(['-p', 'and add tests', '--cloud', 'session_01abc', '--output-format', 'json'])
    assertNoPermissionFlags(argv)
  })

  it('teleport takes only a validated id', () => {
    expect(teleportArgv('session_01abc')).toEqual(['--teleport', 'session_01abc'])
    assertNoPermissionFlags(teleportArgv('session_01abc'))
    expect(() => teleportArgv('x; rm -rf /')).toThrow(/Invalid cloud session id/)
    expect(() => teleportArgv('$(whoami)')).toThrow(/Invalid cloud session id/)
    expect(() => cloudSendArgv('a b', 'hi')).toThrow(/Invalid cloud session id/)
  })

  it('builds a shell-safe command for the PTY', () => {
    expect(claudeShellCommand(teleportArgv('session_01abc'))).toBe('claude --teleport session_01abc')
  })
})

describe('parseCloudResult', () => {
  it('reads the documented JSON shape', () => {
    const out = JSON.stringify({ ok: true, session_id: 'session_01XYZ', url: 'https://claude.ai/code/session_01XYZ' })
    expect(parseCloudResult(out)).toEqual({ sessionId: 'session_01XYZ', url: 'https://claude.ai/code/session_01XYZ' })
  })

  it('finds the JSON line among other output', () => {
    const out = `warming up\n${JSON.stringify({ ok: true, session_id: 'session_02', url: 'https://claude.ai/code/session_02' })}\n`
    expect(parseCloudResult(out).sessionId).toBe('session_02')
  })

  it('derives a URL when only an id comes back', () => {
    expect(parseCloudResult('{"ok":true,"sessionId":"session_03"}')).toEqual({
      sessionId: 'session_03',
      url: 'https://claude.ai/code/session_03',
    })
  })

  it('falls back to scanning text for a claude.ai/code URL', () => {
    const r = parseCloudResult('Created! View it at https://claude.ai/code/session_04abcdef\n')
    expect(r).toEqual({ sessionId: 'session_04abcdef', url: 'https://claude.ai/code/session_04abcdef' })
  })

  it('surfaces an ok:false error', () => {
    expect(() => parseCloudResult('{"ok":false,"error":"Repository not connected to Claude GitHub App"}')).toThrow(
      'Repository not connected to Claude GitHub App'
    )
  })

  it('throws with stderr detail when nothing is recognisable', () => {
    expect(() => parseCloudResult('', 'error: unknown option --cloud')).toThrow(/unknown option --cloud/)
  })
})

describe('reading the interactive create PTY', () => {
  const ID = 'session_01AbCdEfGhIjKlMnOpQrStUv'

  it('finds the "View:" URL the CLI prints when it creates the session and exits', () => {
    const out = [
      '\x1b[2mCreating remote session…\x1b[22m\r\n',
      `Created cloud session: Fix login\r\nView: \x1b[36mhttps://claude.ai/code/${ID}?from=cli&m=0\x1b[39m\r\n`,
      `Resume with: claude --teleport ${ID}\r\n`,
    ].join('')
    expect(findCloudSessionInOutput(out)).toEqual({ sessionId: ID, url: `https://claude.ai/code/${ID}` })
  })

  it('finds the attached REPL line through spinner redraws and colours', () => {
    const out =
      '\x1b[?25l\x1b[2K\x1b[1A\x1b[2K\x1b[G⠋ Setting up remote session…\r' +
      '\x1b[2K\x1b[1A\x1b[32m✓\x1b[39m Created cloud session\r\n' +
      `\x1b[1mCloud session active\x1b[22m · code here or at \x1b[4mhttps://claude.ai/code/${ID}?from=cli&m=0\x1b[24m\r\n> `
    expect(findCloudSessionInOutput(out)?.sessionId).toBe(ID)
  })

  it('rejoins a URL the terminal wrapped across lines', () => {
    const out = `code here or at https://claude.ai/code/session_01AbCdEfGh\r\n  IjKlMnOpQrStUv?from=cli&m=0\r\n`
    expect(findCloudSessionInOutput(out)?.sessionId).toBe(ID)
  })

  it('prefers the unwrapped URL of an OSC 8 hyperlink', () => {
    const out = `\x1b]8;;https://claude.ai/code/${ID}?from=cli&m=0\x07https://claude.ai/code/sess…\x1b]8;;\x07`
    expect(findCloudSessionInOutput(out)?.sessionId).toBe(ID)
  })

  it('accepts cse_ ids and the Session ID / --teleport lines', () => {
    expect(findCloudSessionInOutput('Session ID: cse_01abcdefgh\r\n')?.sessionId).toBe('cse_01abcdefgh')
    expect(findCloudSessionInOutput('Resume with: claude --teleport session_01xyz123\n')?.sessionId).toBe('session_01xyz123')
  })

  it('returns null for provisioning noise and the CLI usage text', () => {
    expect(findCloudSessionInOutput('Setting up remote session…\r\n  Checking this checkout\r\n')).toBeNull()
    expect(
      findCloudSessionInOutput('pass its ID: `claude -p "message" --cloud <session-id>` (find IDs at claude.ai/code).')
    ).toBeNull()
    expect(findCloudSessionInOutput('https://claude.ai/code/session_x')).toBeNull()
  })

  it('stripAnsi leaves plain text', () => {
    expect(stripAnsi('\x1b[31mred\x1b[0m a\x1b[3Cb\r\nc\x1b]0;title\x07')).toBe('red a b\nc')
  })

  it('summarises a failure from the last meaningful lines', () => {
    const out = '\x1b[31mError: --cloud requires an interactive terminal.\x1b[0m\r\n\r\n'
    expect(summarizeCreateFailure(out)).toBe('Error: --cloud requires an interactive terminal.')
    expect(summarizeCreateFailure('a\nb\nc\nd', 2)).toBe('c\nd')
  })

  it('notices a create cancelled after the request was sent', () => {
    expect(
      mayHaveCreatedSession('Cancelled after the create request was sent, so a cloud session may still have been created')
    ).toBe(true)
    expect(mayHaveCreatedSession('Cancelled before a cloud session was created')).toBe(false)
  })
})

describe('branch instruction', () => {
  it('prepends the branch to the prompt', () => {
    const p = withBranchInstruction('fix it', 'session/a')
    expect(p).toMatch(/^Work on the git branch `session\/a`/)
    expect(p).toContain('git push origin session/a')
    expect(p.endsWith('\n\nfix it')).toBe(true)
  })

  it('recognises an unknown --on-branch option', () => {
    expect(isUnknownOnBranchError("error: unknown option '--on-branch'")).toBe(true)
    expect(isUnknownOnBranchError('Unrecognized argument: --on-branch')).toBe(true)
    expect(isUnknownOnBranchError('Not logged in')).toBe(false)
  })
})

describe('sendCloudMessage', () => {
  it('queues a follow-up against the session id', async () => {
    h.state.claudeOut = { stdout: '{"ok":true,"session_id":"session_06","url":"https://claude.ai/code/session_06"}', stderr: '', code: 0 }
    await sendCloudMessage({ worktreePath: '/wt', cloudSessionId: 'session_06', message: 'status?' })
    expect(h.state.spawnCalls[0].args).toEqual(['-p', 'status?', '--cloud', 'session_06', '--output-format', 'json'])
    expect(h.state.gitCalls).toHaveLength(0)
  })
})

describe('cloudEnv', () => {
  it('drops an inherited CLAUDE_CONFIG_DIR for the default account', () => {
    const prev = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = '/somewhere/else'
    try {
      expect(cloudEnv(null).CLAUDE_CONFIG_DIR).toBeUndefined()
      expect(cloudEnv('~/.claude-work').CLAUDE_CONFIG_DIR).toMatch(/\.claude-work$/)
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = prev
    }
  })
})

describe('dirty worktree detection', () => {
  it('parses porcelain and ignores our own hook settings', () => {
    expect(parsePorcelain(' M src/a.ts\n?? .claude/settings.local.json\nR  old.ts -> new.ts\n?? "spaced name.ts"\n')).toEqual([
      'src/a.ts',
      'new.ts',
      'spaced name.ts',
    ])
  })

  it('runs git status in the worktree', async () => {
    h.state.gitResult.status = { stdout: '' }
    expect(await worktreeDirtyFiles('/wt')).toEqual([])
    expect(h.state.gitCalls[0]).toEqual({ args: ['status', '--porcelain'], cwd: '/wt' })
  })
})

describe('discoverTeleportedSession', () => {
  let root: string
  const worktree = '/Users/me/wt/feat.cloud'
  const projectDir = () => join(root, 'projects', encodeProjectDir(worktree))
  const touch = (name: string, at: Date) => {
    const p = join(projectDir(), name)
    writeFileSync(p, '{}\n')
    utimesSync(p, at, at)
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cloud-discover-'))
    mkdirSync(projectDir(), { recursive: true })
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('encodes the worktree path the way Claude Code does', () => {
    expect(encodeProjectDir('/Users/me/wt/feat.cloud')).toBe('-Users-me-wt-feat-cloud')
  })

  it('picks the newest transcript written after the teleport', async () => {
    const since = new Date('2026-10-21T10:00:00Z')
    touch('old-session.jsonl', new Date('2026-10-20T10:00:00Z'))
    touch('aaaa-1111.jsonl', new Date('2026-10-21T10:01:00Z'))
    touch('bbbb-2222.jsonl', new Date('2026-10-21T10:02:00Z'))
    touch('notes.txt', new Date('2026-10-21T10:05:00Z'))
    expect(await discoverTeleportedSession({ worktreePath: worktree, configDir: root, since: since.toISOString() })).toBe('bbbb-2222')
  })

  it('prefers the transcript carrying a teleport marker over a newer unrelated one', async () => {
    const since = new Date('2026-10-21T10:00:00Z')
    const write = (name: string, body: string, at: Date) => {
      const p = join(projectDir(), name)
      writeFileSync(p, body)
      utimesSync(p, at, at)
    }
    write('tele-1111.jsonl', '{"type":"user","remoteSourced":true,"message":{"role":"user","content":"hi"}}\n', new Date('2026-10-21T10:01:00Z'))
    write('later-2222.jsonl', '{"type":"user","message":{"role":"user","content":"other"}}\n', new Date('2026-10-21T10:03:00Z'))
    write('meta-3333.jsonl', '{"type":"user","isMeta":true,"message":{"role":"user","content":"This session is being continued from another machine."}}\n', new Date('2026-10-21T10:02:00Z'))
    const found = await findTeleportTranscript({ worktreePath: worktree, configDir: root, since: since.toISOString() })
    expect(found).toMatchObject({ id: 'meta-3333', marked: true })
    expect(await discoverTeleportedSession({ worktreePath: worktree, configDir: root, since: since.toISOString() })).toBe('meta-3333')
  })

  it('returns null when nothing was written since', async () => {
    touch('old-session.jsonl', new Date('2026-10-20T10:00:00Z'))
    expect(
      await discoverTeleportedSession({ worktreePath: worktree, configDir: root, since: '2026-10-21T10:00:00Z' })
    ).toBeNull()
  })

  it('returns null for a missing directory or bad timestamp', async () => {
    expect(await discoverTeleportedSession({ worktreePath: '/nope', configDir: root, since: '2026-10-21T10:00:00Z' })).toBeNull()
    expect(await discoverTeleportedSession({ worktreePath: worktree, configDir: root, since: 'garbage' })).toBeNull()
  })
})
