/**
 * Names a session from its first message with a single cheap Haiku turn on the
 * user's own Claude Code login (`claude -p`, the same runner as the headless
 * review loop). No tools, a one-line system prompt instead of Claude Code's,
 * and nothing saved to the resume list.
 */
import { tmpdir } from 'node:os'
import { runHeadlessClaude } from './claude-headless.service'
import { toSessionName } from '../../shared/session-name'

const NAMER_TIMEOUT_MS = 60_000
/** Only the start of a long first message is needed to name it. */
const MAX_PROMPT_CHARS = 2000

const SYSTEM_PROMPT =
  'You name coding-agent sessions. Reply with only the name: 2 to 4 lowercase words joined by hyphens, ' +
  'like fix-login-redirect. No quotes, punctuation or explanation.'

export function buildNamerPrompt(firstMessage: string): string {
  const message = firstMessage.trim().slice(0, MAX_PROMPT_CHARS)
  return `Name the session that starts with this message:\n\n<message>\n${message}\n</message>`
}

/**
 * A short kebab-case name for a session whose first message is `firstMessage`,
 * or null when the run fails or replies with nothing usable.
 */
export async function suggestSessionName(firstMessage: string, configDir?: string | null): Promise<string | null> {
  if (!firstMessage.trim()) return null
  const result = await runHeadlessClaude({
    // Outside any repo: the run must not pick up (or fire) a worktree's hooks.
    cwd: tmpdir(),
    prompt: buildNamerPrompt(firstMessage),
    env: configDir ? { CLAUDE_CONFIG_DIR: configDir } : undefined,
    timeoutMs: NAMER_TIMEOUT_MS,
    extraArgs: ['--model', 'haiku', '--tools', '', '--system-prompt', SYSTEM_PROMPT, '--no-session-persistence'],
  })
  if (!result.ok || !result.resultText) return null
  return toSessionName(result.resultText)
}
