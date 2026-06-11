import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const hoisted = vi.hoisted(() => ({
  port: 4567 as number | null,
  home: '',
  registerCalls: [] as string[],
}))

vi.mock('../../../src/main/services/notification-server', () => ({
  getNotificationServerPort: () => hoisted.port,
}))

vi.mock('../../../src/main/services/usage.service', () => ({
  getUsageTempPath: (sessionId: string) => `/tmp/fake-usage-${sessionId}.json`,
  registerSession: (sessionId: string) => {
    hoisted.registerCalls.push(sessionId)
  },
}))

import { writeClaudeHookSettings } from '../../../src/main/services/hook.service'

let worktree: string

function settingsPath(): string {
  return join(worktree, '.claude', 'settings.local.json')
}

function readSettings(): Record<string, any> {
  return JSON.parse(readFileSync(settingsPath(), 'utf-8'))
}

function claudeJsonPath(): string {
  return join(hoisted.home, '.claude.json')
}

// `os.homedir()` honors $HOME on POSIX, so pointing HOME at a temp dir
// redirects the ~/.claude.json theme sync without touching the real home.
let realHome: string | undefined

beforeEach(() => {
  hoisted.port = 4567
  hoisted.registerCalls.length = 0
  hoisted.home = mkdtempSync(join(tmpdir(), 'cc-hook-home-'))
  realHome = process.env.HOME
  process.env.HOME = hoisted.home
  worktree = mkdtempSync(join(tmpdir(), 'cc-hook-wt-'))
})

afterEach(() => {
  process.env.HOME = realHome
  rmSync(worktree, { recursive: true, force: true })
  rmSync(hoisted.home, { recursive: true, force: true })
})

describe('hook.service writeClaudeHookSettings', () => {
  it('does nothing when the notification server has no port yet', () => {
    hoisted.port = null
    writeClaudeHookSettings(worktree)
    expect(existsSync(join(worktree, '.claude'))).toBe(false)
  })

  it('writes UserPromptSubmit, Notification and Stop hooks pointing at the local hook server', () => {
    writeClaudeHookSettings(worktree)
    const settings = readSettings()
    for (const [event, type] of [
      ['UserPromptSubmit', 'prompt'],
      ['Notification', 'notification'],
      ['Stop', 'stop'],
    ] as const) {
      const entries = settings.hooks[event]
      expect(entries).toHaveLength(1)
      const hook = entries[0].hooks[0]
      expect(hook.type).toBe('command')
      expect(hook.timeout).toBe(5)
      expect(hook.command).toContain(`http://127.0.0.1:4567/hook?type=${type}`)
      expect(hook.command).toContain('${CRUCIBLE_CONTEXT_ID}')
      expect(hook.command).toContain('${CRUCIBLE_TAB_ID}')
    }
  })

  it('deliberately does not configure a SubagentStop hook', () => {
    writeClaudeHookSettings(worktree)
    expect(readSettings().hooks.SubagentStop).toBeUndefined()
  })

  it('creates the .claude directory when missing', () => {
    expect(existsSync(join(worktree, '.claude'))).toBe(false)
    writeClaudeHookSettings(worktree)
    expect(existsSync(settingsPath())).toBe(true)
  })

  it('preserves user-defined hooks for other event types', () => {
    mkdirSync(join(worktree, '.claude'), { recursive: true })
    writeFileSync(
      settingsPath(),
      JSON.stringify({
        hooks: {
          PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo done' }] }],
        },
      })
    )
    writeClaudeHookSettings(worktree)
    const settings = readSettings()
    expect(settings.hooks.PostToolUse).toEqual([
      { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo done' }] },
    ])
  })

  it('appends user hooks on shared event types after the CodeCrucible hook', () => {
    mkdirSync(join(worktree, '.claude'), { recursive: true })
    writeFileSync(
      settingsPath(),
      JSON.stringify({
        hooks: {
          Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'say finished' }] }],
        },
      })
    )
    writeClaudeHookSettings(worktree)
    const stop = readSettings().hooks.Stop
    expect(stop).toHaveLength(2)
    expect(stop[0].hooks[0].command).toContain('127.0.0.1')
    expect(stop[1].hooks[0].command).toBe('say finished')
  })

  it('rewriting does not duplicate its own hooks (old CC curl hooks are filtered out)', () => {
    writeClaudeHookSettings(worktree)
    writeClaudeHookSettings(worktree)
    const settings = readSettings()
    expect(settings.hooks.Stop).toHaveLength(1)
    expect(settings.hooks.Notification).toHaveLength(1)
    expect(settings.hooks.UserPromptSubmit).toHaveLength(1)
  })

  it('preserves unrelated top-level settings keys (e.g. permissions)', () => {
    mkdirSync(join(worktree, '.claude'), { recursive: true })
    writeFileSync(
      settingsPath(),
      JSON.stringify({ permissions: { allow: ['Bash(ls:*)'], deny: [] } })
    )
    writeClaudeHookSettings(worktree)
    expect(readSettings().permissions).toEqual({ allow: ['Bash(ls:*)'], deny: [] })
  })

  it('overwrites malformed existing settings without throwing', () => {
    mkdirSync(join(worktree, '.claude'), { recursive: true })
    writeFileSync(settingsPath(), '{broken json')
    expect(() => writeClaudeHookSettings(worktree)).not.toThrow()
    expect(readSettings().hooks.Stop).toHaveLength(1)
  })

  it('configures a statusLine tee into the session usage file and registers the session', () => {
    writeClaudeHookSettings(worktree, 'dark', 'sess-42')
    const settings = readSettings()
    expect(settings.statusLine).toEqual({
      type: 'command',
      command: 'tee "/tmp/fake-usage-sess-42.json" > /dev/null',
    })
    expect(hoisted.registerCalls).toEqual(['sess-42'])
  })

  it('leaves statusLine alone when no session id is provided', () => {
    mkdirSync(join(worktree, '.claude'), { recursive: true })
    writeFileSync(
      settingsPath(),
      JSON.stringify({ statusLine: { type: 'command', command: 'existing' } })
    )
    writeClaudeHookSettings(worktree)
    expect(readSettings().statusLine).toEqual({ type: 'command', command: 'existing' })
    expect(hoisted.registerCalls).toEqual([])
  })
})

describe('hook.service theme sync to ~/.claude.json', () => {
  it('writes the theme to ~/.claude.json', () => {
    writeClaudeHookSettings(worktree, 'light')
    const parsed = JSON.parse(readFileSync(claudeJsonPath(), 'utf-8'))
    expect(parsed.theme).toBe('light')
  })

  it('merges with existing ~/.claude.json keys instead of clobbering them', () => {
    writeFileSync(claudeJsonPath(), JSON.stringify({ theme: 'light', numStartups: 9 }))
    writeClaudeHookSettings(worktree, 'dark')
    const parsed = JSON.parse(readFileSync(claudeJsonPath(), 'utf-8'))
    expect(parsed).toEqual({ theme: 'dark', numStartups: 9 })
  })

  it('skips rewriting ~/.claude.json when the theme is unchanged', () => {
    // Write with non-pretty formatting; an actual rewrite would re-serialize
    // with 2-space indentation, so byte-equality proves no write happened.
    const original = JSON.stringify({ theme: 'dark', other: true })
    writeFileSync(claudeJsonPath(), original)
    writeClaudeHookSettings(worktree, 'dark')
    expect(readFileSync(claudeJsonPath(), 'utf-8')).toBe(original)
  })

  it('replaces a malformed ~/.claude.json with a valid themed one', () => {
    writeFileSync(claudeJsonPath(), 'not-json')
    writeClaudeHookSettings(worktree, 'dark')
    expect(JSON.parse(readFileSync(claudeJsonPath(), 'utf-8'))).toEqual({ theme: 'dark' })
  })
})
