import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', isPackaged: false } }))
vi.mock('electron-store', () => ({ default: class { constructor(){} get(){return {}} set(){} delete(){} } }))
vi.mock('node-pty', () => ({ spawn: vi.fn() }))
vi.mock('../../../src/main/services/notification-server', () => ({
  handleHookEvent: vi.fn(),
  findContextById: vi.fn(),
}))
vi.mock('../../../src/main/store-path', () => ({ getStorePath: () => '/tmp' }))

import { buildClaudeCommand } from '../../../src/main/services/terminal.service'

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
