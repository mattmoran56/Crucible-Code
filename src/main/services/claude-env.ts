/**
 * Environment hygiene for the `claude` processes the app spawns.
 *
 * When the app itself was started from inside a Claude Code session (e.g.
 * `npm run dev` run by an agent, or launched from a Claude Code terminal),
 * process.env carries the markers Claude Code sets on its child processes.
 * Every `claude` we spawn would inherit them and believe it is a nested child
 * of that session. Claude Code then (verified in the 2.1.308 binary):
 *  - turns transcript saving OFF ("Transcript saving is off — inherited
 *    CLAUDE_CODE_CHILD_SESSION marker"): nothing is written under
 *    `<config>/projects/`, so teleports never finish and `--resume` finds
 *    nothing;
 *  - skips history.jsonl;
 *  - reports the parent's session id / entrypoint / messaging socket.
 * These are never meaningful for a session the app starts, so drop them.
 */

/** Markers a parent Claude Code session puts on its children. */
export const INHERITED_CLAUDE_SESSION_VARS = [
  'CLAUDECODE',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_PID',
  'AI_AGENT',
] as const

/**
 * Remove inherited parent-session markers from `env` in place and return it.
 * CLAUDE_EFFORT is dropped too, but only when it came with a parent session
 * (a user may set it themselves).
 */
export function scrubInheritedClaudeSession<T extends Record<string, string | undefined>>(env: T): T {
  const fromParent = !!(env.CLAUDECODE || env.CLAUDE_CODE_CHILD_SESSION)
  for (const key of INHERITED_CLAUDE_SESSION_VARS) delete env[key]
  if (fromParent) delete env.CLAUDE_EFFORT
  return env
}
