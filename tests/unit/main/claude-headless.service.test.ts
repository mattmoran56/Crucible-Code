import { beforeEach, describe, expect, it, vi } from 'vitest'

// Capture spawn calls + drive a fake child process from the test.
const h = vi.hoisted(() => {
  const s: any = { spawnCalls: [], child: null }
  s.makeChild = () => {
    const listeners: Record<string, Function[]> = {}
    const child: any = {
      pid: 4242,
      killed: false,
      stdout: { on: (_e: string, cb: Function) => ((listeners[`stdout:${_e}`] ??= []).push(cb)) },
      stderr: { on: (_e: string, cb: Function) => ((listeners[`stderr:${_e}`] ??= []).push(cb)) },
      stdin: { write: vi.fn(), end: vi.fn() },
      on: (e: string, cb: Function) => ((listeners[e] ??= []).push(cb)),
      kill: vi.fn(),
      _emitStdout: (buf: Buffer) => (listeners['stdout:data'] ?? []).forEach((f) => f(buf)),
      _exit: (code: number, signal: any = null) =>
        (listeners['exit'] ?? []).forEach((f) => f(code, signal)),
    }
    return child
  }
  return s
})

vi.mock('node:child_process', () => {
  const spawn = (file: string, args: string[], opts: unknown) => {
    h.spawnCalls.push({ file, args, opts })
    h.child = h.makeChild()
    return h.child
  }
  return { spawn, default: { spawn } }
})

// claude-headless imports AUTO_PERMISSION_MODE_ARGS from terminal.service; mirror
// the real (empty) constant without loading electron / node-pty.
vi.mock('../../../src/main/services/terminal.service', () => ({
  AUTO_PERMISSION_MODE_ARGS: [],
}))

import {
  runHeadlessClaude,
  summarizeToolInput,
  killChildTree,
} from '../../../src/main/services/claude-headless.service'

beforeEach(() => {
  h.spawnCalls = []
  h.child = null
})

describe('runHeadlessClaude — command construction', () => {
  it('runs `claude --print --output-format stream-json --verbose` and NEVER bypasses permissions', async () => {
    const p = runHeadlessClaude({ cwd: '/wt', prompt: 'review please' })
    // Let the spawn happen, then exit cleanly.
    await Promise.resolve()
    h.child._exit(0)
    await p

    const { file, args } = h.spawnCalls[0]
    expect(file).toBe('claude')
    expect(args).toEqual(['--print', '--output-format', 'stream-json', '--verbose'])
    // The whole point of the no-bypass posture:
    expect(args).not.toContain('--dangerously-skip-permissions')
    expect(args).not.toContain('--permission-mode')
    expect(args).not.toContain('acceptEdits')
  })

  it('pipes the prompt on stdin and appends --resume / extraArgs when given', async () => {
    const p = runHeadlessClaude({
      cwd: '/wt',
      prompt: 'do it',
      resumeId: 'sess-abc',
      extraArgs: ['--model', 'opus'],
    })
    await Promise.resolve()
    expect(h.child.stdin.write).toHaveBeenCalledWith('do it')
    expect(h.child.stdin.end).toHaveBeenCalled()
    h.child._exit(0)
    await p

    const { args } = h.spawnCalls[0]
    expect(args).toContain('--resume')
    expect(args).toContain('sess-abc')
    expect(args.slice(-2)).toEqual(['--model', 'opus'])
  })
})

describe('runHeadlessClaude — CLAUDE_CONFIG_DIR handling', () => {
  it('expands a leading ~/ in the caller-provided config dir (subprocess has no shell to do it)', async () => {
    const p = runHeadlessClaude({
      cwd: '/wt',
      prompt: 'x',
      env: { CLAUDE_CONFIG_DIR: '~/.claude-personal' },
    })
    await Promise.resolve()
    h.child._exit(0)
    await p

    const dir = h.spawnCalls[0].opts.env.CLAUDE_CONFIG_DIR as string
    expect(dir.startsWith('~/')).toBe(false)
    expect(dir.startsWith('/')).toBe(true)
    expect(dir.endsWith('/.claude-personal')).toBe(true)
  })

  it('leaves an absolute config dir untouched', async () => {
    const p = runHeadlessClaude({
      cwd: '/wt',
      prompt: 'x',
      env: { CLAUDE_CONFIG_DIR: '/Users/matt/.claude-personal' },
    })
    await Promise.resolve()
    h.child._exit(0)
    await p
    expect(h.spawnCalls[0].opts.env.CLAUDE_CONFIG_DIR).toBe('/Users/matt/.claude-personal')
  })

  it('drops an inherited CLAUDE_CONFIG_DIR when the caller does not pass one', async () => {
    const prev = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = '~/.claude-personal'
    try {
      const p = runHeadlessClaude({ cwd: '/wt', prompt: 'x' })
      await Promise.resolve()
      h.child._exit(0)
      await p
      expect(h.spawnCalls[0].opts.env.CLAUDE_CONFIG_DIR).toBeUndefined()
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = prev
    }
  })
})

describe('runHeadlessClaude — stream-json parsing', () => {
  it('turns assistant text + tool_use events into streamed transcript lines', async () => {
    const streamed: string[] = []
    const p = runHeadlessClaude({ cwd: '/wt', prompt: 'x', onTranscript: (l) => streamed.push(l) })
    await Promise.resolve()

    h.child._emitStdout(
      Buffer.from(
        JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1', model: 'opus' }) + '\n'
      )
    )
    h.child._emitStdout(
      Buffer.from(
        JSON.stringify({
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'hello world' }] },
        }) + '\n'
      )
    )
    h.child._emitStdout(
      Buffer.from(
        JSON.stringify({
          type: 'assistant',
          message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'src/a.ts' } }] },
        }) + '\n'
      )
    )
    h.child._exit(0)
    const res = await p

    expect(res.ok).toBe(true)
    expect(res.sessionId).toBe('s1')
    // onTranscript and the returned transcript agree.
    expect(streamed).toEqual(res.transcript)
    expect(res.transcript.some((l) => l.includes('session s1 started'))).toBe(true)
    expect(res.transcript.some((l) => l.includes('hello world'))).toBe(true)
    expect(res.transcript.some((l) => l.includes('🔧 Read src/a.ts'))).toBe(true)
  })

  it('reports a non-zero exit as a failure', async () => {
    const p = runHeadlessClaude({ cwd: '/wt', prompt: 'x' })
    await Promise.resolve()
    h.child._exit(2)
    const res = await p
    expect(res.ok).toBe(false)
    expect(res.exitCode).toBe(2)
    expect(res.error).toMatch(/code 2/)
  })
})

describe('summarizeToolInput', () => {
  it('prefers a known descriptive field and truncates long values', () => {
    expect(summarizeToolInput({ file_path: 'src/a.ts' })).toBe('src/a.ts')
    expect(summarizeToolInput({ command: 'echo hi' })).toBe('echo hi')
    expect(summarizeToolInput('not an object')).toBe('')
    expect(summarizeToolInput({ file_path: 'x'.repeat(200) }).length).toBeLessThanOrEqual(120)
  })
})

describe('killChildTree', () => {
  it('is a no-op for an already-killed / pid-less child and never throws', () => {
    expect(() => killChildTree({ killed: true, pid: 1 } as any)).not.toThrow()
    expect(() => killChildTree({ killed: false, pid: null } as any)).not.toThrow()
  })
})
