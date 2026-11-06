/**
 * Names a session (and its branch) from its first message with a single cheap
 * Haiku turn on the user's own Claude Code login (`claude -p`, the same runner
 * as the headless review loop). No tools, a short system prompt instead of
 * Claude Code's, and nothing saved to the resume list.
 */
import { tmpdir } from 'node:os'
import { runHeadlessClaude } from './claude-headless.service'
import { toSessionName } from '../../shared/session-name'
import { toTypedBranchName } from '../../shared/branch-name'
import type { SessionNameSuggestion } from '../../shared/types'

const NAMER_TIMEOUT_MS = 60_000
/** Only the start of a long first message is needed to name it. */
const MAX_PROMPT_CHARS = 2000

export const NAMER_SYSTEM_PROMPT =
  'You name coding-agent sessions and their git branches. Reply with exactly two lines and nothing else.\n' +
  'Line 1: the session name, 2 to 4 words separated by spaces, like Fix login redirect.\n' +
  'Line 2: the git branch, type/short-description: feat/ for new features or behaviour, fix/ for bug fixes, ' +
  'chore/ for everything else (refactors, docs, tests, dependencies, tooling). The description is 2 to 4 ' +
  'lowercase words joined by hyphens, like fix/login-redirect or feat/dark-mode-toggle.\n' +
  'No quotes, labels, punctuation or explanation.'

export function buildNamerPrompt(firstMessage: string): string {
  const message = firstMessage.trim().slice(0, MAX_PROMPT_CHARS)
  return `Name the session that starts with this message, and its branch:\n\n<message>\n${message}\n</message>`
}

/**
 * Parse the namer's two-line reply. The branch falls back to one built from
 * the name when the model gave a name only.
 */
export function parseNamerReply(text: string): SessionNameSuggestion | null {
  const lines = text
    .split('\n')
    .map((l) => l.trim().replace(/^(session\s*name|name|branch)\s*:\s*/i, ''))
    .filter(Boolean)
  const name = lines[0] ? toSessionName(lines[0]) : null
  if (!name) return null
  const branch = toTypedBranchName(lines[1] ?? '', name)
  return { name, branch }
}

/**
 * A short human-readable name (`Fix login redirect`) and a typed branch
 * (`fix/login-redirect`) for a session whose first message is `firstMessage`,
 * or null when the run fails or replies with nothing usable.
 */
export async function suggestSessionName(firstMessage: string, configDir?: string | null): Promise<SessionNameSuggestion | null> {
  if (!firstMessage.trim()) return null
  const result = await runHeadlessClaude({
    // Outside any repo: the run must not pick up (or fire) a worktree's hooks.
    cwd: tmpdir(),
    prompt: buildNamerPrompt(firstMessage),
    env: configDir ? { CLAUDE_CONFIG_DIR: configDir } : undefined,
    timeoutMs: NAMER_TIMEOUT_MS,
    extraArgs: ['--model', 'haiku', '--tools', '', '--system-prompt', NAMER_SYSTEM_PROMPT, '--no-session-persistence'],
  })
  if (!result.ok || !result.resultText) return null
  return parseNamerReply(result.resultText)
}
