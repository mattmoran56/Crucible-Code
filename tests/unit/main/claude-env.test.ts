// Reproduces the teleport that never saved: the app was started from inside
// a Claude Code session (an agent ran `npm run dev`), so process.env carried
// CLAUDECODE / CLAUDE_CODE_CHILD_SESSION / CLAUDE_CODE_SESSION_ID… and the
// `claude --teleport` PTY inherited them. Claude Code then runs with
// "Transcript saving is off — inherited CLAUDE_CODE_CHILD_SESSION marker":
// no transcript, no history.jsonl — so the teleport could never finish.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/main/services/terminal.service', () => ({
  AUTO_PERMISSION_MODE_ARGS: [],
  shellQuote: (s: string) => `'${s}'`,
}))

import { INHERITED_CLAUDE_SESSION_VARS, scrubInheritedClaudeSession } from '../../../src/main/services/claude-env'
import { cloudEnv } from '../../../src/main/services/cloud-session.service'

/** What a parent Claude Code session (2.1.308) puts on its child processes. */
const PARENT_SESSION_ENV = {
  CLAUDECODE: '1',
  CLAUDE_CODE_SESSION_ID: 'b36fd2e8-e9eb-444b-95f6-42a4c530c71f',
  CLAUDE_CODE_CHILD_SESSION: '1',
  CLAUDE_CODE_SESSION_ATTENDED: '0',
  CLAUDE_CODE_ENTRYPOINT: 'sdk-cli',
  CLAUDE_CODE_EXECPATH: '/Users/x/.local/share/claude/versions/2.1.306',
  CLAUDE_CODE_MESSAGING_SOCKET: '/tmp/cc-socks/7674.sock',
  CLAUDE_CODE_MESSAGING_TOKEN: 'secret',
  CLAUDE_PID: '7674',
  CLAUDE_EFFORT: 'medium',
}

describe('scrubInheritedClaudeSession', () => {
  it('drops every parent-session marker and keeps everything else', () => {
    const env = scrubInheritedClaudeSession({ ...PARENT_SESSION_ENV, PATH: '/bin', CLAUDE_CONFIG_DIR: '/c', HOME: '/h' })
    for (const key of Object.keys(PARENT_SESSION_ENV)) expect(env).not.toHaveProperty(key)
    expect(env).toEqual({ PATH: '/bin', CLAUDE_CONFIG_DIR: '/c', HOME: '/h' })
  })

  it("keeps a user's own CLAUDE_EFFORT when there is no parent session", () => {
    expect(scrubInheritedClaudeSession({ CLAUDE_EFFORT: 'high' })).toEqual({ CLAUDE_EFFORT: 'high' })
  })

  it('covers the markers that switch transcript saving off', () => {
    expect(INHERITED_CLAUDE_SESSION_VARS).toEqual(expect.arrayContaining(['CLAUDECODE', 'CLAUDE_CODE_CHILD_SESSION']))
  })
})

describe('spawned claude env when the app runs inside a Claude Code session', () => {
  const saved = { ...process.env }
  beforeEach(() => Object.assign(process.env, PARENT_SESSION_ENV))
  afterEach(() => {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
    Object.assign(process.env, saved)
  })

  it('cloudEnv (claude --remote / --teleport) carries no child-session marker', () => {
    const env = cloudEnv(null)
    expect(env.CLAUDE_CODE_CHILD_SESSION).toBeUndefined()
    expect(env.CLAUDECODE).toBeUndefined()
    expect(env.CLAUDE_CODE_SESSION_ID).toBeUndefined()
    expect(env.PATH).toBe(process.env.PATH)
  })
})
