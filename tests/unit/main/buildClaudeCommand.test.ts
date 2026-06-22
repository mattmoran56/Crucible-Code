import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', isPackaged: false } }))
vi.mock('electron-store', () => ({ default: class { constructor(){} get(){return {}} set(){} delete(){} } }))
vi.mock('node-pty', () => ({ spawn: vi.fn() }))
vi.mock('../../../src/main/services/notification-server', () => ({
  handleHookEvent: vi.fn(),
  findContextById: vi.fn(),
}))
vi.mock('../../../src/main/store-path', () => ({ getStorePath: () => '/tmp' }))

import {
  buildClaudeCommand,
  AUTO_PERMISSION_MODE_ARGS,
} from '../../../src/main/services/terminal.service'

describe('AUTO_PERMISSION_MODE_ARGS', () => {
  it('is empty so sessions inherit the user default (auto) mode', () => {
    // The fix: we pass NO --permission-mode, letting the CLI use the user's
    // configured default of `auto`. Passing acceptEdits forced sessions out of
    // auto, which was the bug.
    expect(AUTO_PERMISSION_MODE_ARGS).toEqual([])
  })

  it('never forces acceptEdits and never bypasses permissions', () => {
    expect(AUTO_PERMISSION_MODE_ARGS).not.toContain('acceptEdits')
    expect(AUTO_PERMISSION_MODE_ARGS).not.toContain('bypassPermissions')
    expect(AUTO_PERMISSION_MODE_ARGS).not.toContain('--dangerously-skip-permissions')
    // No explicit --permission-mode at all → inherit the auto default.
    expect(AUTO_PERMISSION_MODE_ARGS).not.toContain('--permission-mode')
  })

  it('produces a plain `claude` launch (no permission flag) for a fresh session', () => {
    const cmd = buildClaudeCommand({
      isResume: false,
      isReview: false,
      claudeArgs: AUTO_PERMISSION_MODE_ARGS,
    })
    expect(cmd).toBe('claude')
    expect(cmd).not.toContain('--permission-mode')
    expect(cmd).not.toContain('acceptEdits')
  })
})

describe('buildClaudeCommand', () => {
  it('plain claude on fresh launch', () => {
    expect(buildClaudeCommand({ isResume: false, isReview: false })).toBe('claude')
  })

  it('--resume on auto-restart', () => {
    expect(buildClaudeCommand({ isResume: true, isReview: false })).toBe('claude --resume')
  })

  it('review mode never resumes', () => {
    expect(buildClaudeCommand({ isResume: true, isReview: true })).toBe('claude')
  })

  it('heredoc-wraps the command string on first launch', () => {
    const out = buildClaudeCommand({
      isResume: false,
      isReview: false,
      commandString: '/notion-ticket https://notion.so/abc',
    })
    expect(out).toContain("claude <<'CRUCIBLE_PROMPT_EOF'")
    expect(out).toContain('/notion-ticket https://notion.so/abc')
    expect(out).toContain('CRUCIBLE_PROMPT_EOF')
  })

  it('appends safe claudeArgs unquoted', () => {
    expect(
      buildClaudeCommand({
        isResume: false,
        isReview: false,
        claudeArgs: ['--dangerously-skip-permissions'],
      })
    ).toBe('claude --dangerously-skip-permissions')
  })

  it('quotes args containing shell-meaningful chars', () => {
    expect(
      buildClaudeCommand({
        isResume: false,
        isReview: false,
        claudeArgs: ["--model", "needs space"],
      })
    ).toBe("claude --model 'needs space'")
  })

  it('combines args with --resume', () => {
    expect(
      buildClaudeCommand({
        isResume: true,
        isReview: false,
        claudeArgs: ['--dangerously-skip-permissions'],
      })
    ).toBe('claude --dangerously-skip-permissions --resume')
  })

  it('escapes embedded single quotes', () => {
    expect(
      buildClaudeCommand({
        isResume: false,
        isReview: false,
        claudeArgs: ["it's"],
      })
    ).toBe(`claude 'it'\\''s'`)
  })
})
