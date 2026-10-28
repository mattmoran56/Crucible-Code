import { beforeEach, describe, expect, it, vi } from 'vitest'

const run = vi.hoisted(() => vi.fn())
vi.mock('../../../src/main/services/claude-headless.service', () => ({ runHeadlessClaude: run }))

import { buildNamerPrompt, suggestSessionName } from '../../../src/main/services/session-namer.service'

beforeEach(() => run.mockReset())

describe('suggestSessionName', () => {
  it('runs one tool-less, unsaved Haiku turn outside any repo', async () => {
    run.mockResolvedValue({ ok: true, resultText: 'Fix-Login-Redirect', transcript: [] })
    await expect(suggestSessionName('the login redirect loops', '/cfg')).resolves.toBe('fix-login-redirect')
    const opts = run.mock.calls[0][0]
    expect(opts.cwd).not.toMatch(/repo/)
    expect(opts.env).toEqual({ CLAUDE_CONFIG_DIR: '/cfg' })
    expect(opts.prompt).toContain('the login redirect loops')
    const args: string[] = opts.extraArgs
    expect(args.slice(args.indexOf('--model'), args.indexOf('--model') + 2)).toEqual(['--model', 'haiku'])
    expect(args.slice(args.indexOf('--tools'), args.indexOf('--tools') + 2)).toEqual(['--tools', ''])
    expect(args).toContain('--no-session-persistence')
    expect(args).not.toContain('--dangerously-skip-permissions')
  })

  it('uses the default account when no config dir is given', async () => {
    run.mockResolvedValue({ ok: true, resultText: 'x', transcript: [] })
    await suggestSessionName('hi')
    expect(run.mock.calls[0][0].env).toBeUndefined()
  })

  it('returns null for a failed run or an empty message', async () => {
    run.mockResolvedValue({ ok: false, error: 'boom', transcript: [] })
    await expect(suggestSessionName('hi')).resolves.toBeNull()
    await expect(suggestSessionName('   ')).resolves.toBeNull()
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('sends only the start of a very long message', () => {
    expect(buildNamerPrompt('x'.repeat(10_000)).length).toBeLessThan(2200)
  })
})
