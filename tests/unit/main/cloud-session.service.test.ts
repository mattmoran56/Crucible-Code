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
  cloudCreateArgv,
  cloudEnv,
  cloudSendArgv,
  createCloudSession,
  discoverTeleportedSession,
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
  it('create: -p <prompt> --cloud --output-format json, no permission flags', () => {
    const argv = cloudCreateArgv('  fix the login bug  ')
    expect(argv).toEqual(['-p', 'fix the login bug', '--cloud', '--output-format', 'json'])
    assertNoPermissionFlags(argv)
  })

  it('create: --on-branch <branch> when a branch is given', () => {
    const argv = cloudCreateArgv('go', 'session/feat')
    expect(argv).toEqual(['-p', 'go', '--cloud', '--on-branch', 'session/feat', '--output-format', 'json'])
    assertNoPermissionFlags(argv)
    expect(() => cloudCreateArgv('go', '--force')).toThrow(/Invalid branch name/)
    expect(() => cloudCreateArgv('go', '')).toThrow(/Invalid branch name/)
  })

  it('create: a prompt starting with "-" cannot be read as a flag', () => {
    expect(cloudCreateArgv('--help me')[1]).toBe(' --help me')
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

describe('createCloudSession', () => {
  it('pushes the branch, then runs claude in the worktree with the config dir', async () => {
    h.state.claudeOut = {
      stdout: JSON.stringify({ ok: true, session_id: 'session_05', url: 'https://claude.ai/code/session_05' }),
      stderr: '',
      code: 0,
    }
    const result = await createCloudSession({
      worktreePath: '/wt/feat',
      branch: 'session/feat',
      prompt: 'do the thing',
      configDir: '/cfg/personal',
    })
    expect(result).toEqual({ sessionId: 'session_05', url: 'https://claude.ai/code/session_05', branch: 'session/feat' })
    expect(h.state.gitCalls).toEqual([{ args: ['push', '-u', 'origin', 'session/feat'], cwd: '/wt/feat' }])
    expect(h.state.spawnCalls).toHaveLength(1)
    const call = h.state.spawnCalls[0]
    expect(call.file).toBe('claude')
    expect(call.args).toEqual([
      '-p',
      withBranchInstruction('do the thing', 'session/feat'),
      '--cloud',
      '--on-branch',
      'session/feat',
      '--output-format',
      'json',
    ])
    assertNoPermissionFlags(call.args)
    expect(call.opts.cwd).toBe('/wt/feat')
    expect(call.opts.env.CLAUDE_CONFIG_DIR).toBe('/cfg/personal')
    expect(call.opts.shell).toBeUndefined()
  })

  it('refuses without a prompt and never pushes', async () => {
    await expect(createCloudSession({ worktreePath: '/wt', branch: 'b', prompt: '  ' })).rejects.toThrow(/task description/)
    expect(h.state.gitCalls).toHaveLength(0)
  })

  it('stops if the push fails', async () => {
    h.state.gitResult.push = { err: new Error('exit 128'), stderr: 'fatal: no remote origin' }
    await expect(createCloudSession({ worktreePath: '/wt', branch: 'session/x', prompt: 'go' })).rejects.toThrow(
      /Could not push session\/x to GitHub: fatal: no remote origin/
    )
    expect(h.state.spawnCalls).toHaveLength(0)
  })

  it('retries once without --on-branch when the CLI does not know the flag', async () => {
    h.state.claudeOutQueue = [
      { stdout: '', stderr: "error: unknown option '--on-branch'", code: 1 },
      { stdout: '{"ok":true,"session_id":"session_07"}', stderr: '', code: 0 },
    ]
    const result = await createCloudSession({ worktreePath: '/wt', branch: 'feature/x', prompt: 'go' })
    expect(result).toEqual({ sessionId: 'session_07', url: 'https://claude.ai/code/session_07', branch: 'feature/x' })
    expect(h.state.spawnCalls).toHaveLength(2)
    expect(h.state.spawnCalls[0].args).toContain('--on-branch')
    expect(h.state.spawnCalls[1].args).not.toContain('--on-branch')
    expect(h.state.spawnCalls[1].args[1]).toBe(withBranchInstruction('go', 'feature/x'))
  })

  it('does not retry on other failures', async () => {
    h.state.claudeOut = { stdout: '', stderr: 'Not logged in', code: 1 }
    await expect(createCloudSession({ worktreePath: '/wt', branch: 'b', prompt: 'go' })).rejects.toThrow(/Not logged in/)
    expect(h.state.spawnCalls).toHaveLength(1)
  })

  it('includes the exit code when claude fails', async () => {
    h.state.claudeOut = { stdout: '', stderr: 'Not logged in', code: 1 }
    await expect(createCloudSession({ worktreePath: '/wt', branch: 'b', prompt: 'go' })).rejects.toThrow(
      /Not logged in.*exited with code 1/
    )
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
