/**
 * Foreground phase runner for the review loop.
 *
 * Replaces the old headless `claude --print` engine. Each phase is spawned as a
 * real, interactive `claude` PTY (a terminal the user can watch and type into)
 * via the shared terminal service. We then wait for the phase's `Stop` hook —
 * the ground-truth signal that the agent finished its turn — and freeze the
 * terminal (kill the PTY, suppressing auto-restart) so its scrollback stays
 * readable but read-only.
 *
 * No `-p` / `--print`, no stream-json parsing: the live xterm IS the output.
 */
import type { BrowserWindow } from 'electron'
import {
  spawnTerminal,
  killTerminal,
  getTerminalBuffer,
  AUTO_PERMISSION_MODE_ARGS,
} from './terminal.service'
import { onHookEvent } from './notification-server'
import { writeClaudeHookSettings } from './hook.service'
import { seedPermissions } from './permission-sync.service'
import { runHeadlessClaude, killChildTree } from './claude-headless.service'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Expand a leading `~/` to an absolute path. Env vars aren't shell-expanded, so
 * a raw `~/.claude-personal` CLAUDE_CONFIG_DIR would point claude at a literal
 * `~` dir → "Not logged in". Mirrors the expansion in terminal.service.
 */
function resolveConfigDir(configDir: string): string {
  return configDir.startsWith('~/') ? join(homedir(), configDir.slice(2)) : configDir
}

export const DEFAULT_PHASE_TIMEOUT_MS = 30 * 60 * 1000

export interface ForegroundPhaseOptions {
  window: BrowserWindow
  /** Used as the hook-routing contextId — must be a registered session/context id. */
  sessionId: string
  worktreePath: string
  /** Source repo for permission seeding (optional). */
  repoPath?: string
  claudeTheme?: string
  claudeConfigDir?: string
  /** Workspace tab id, e.g. `review-loop:r1:review`. Must be unique per live phase. */
  tabId: string
  /** Prompt piped into the interactive session via heredoc. */
  prompt: string
  /**
   * Run the phase in the user's default (auto) permission mode so the loop
   * progresses hands-off while still prompting for anything riskier than an
   * edit. We pass no explicit `--permission-mode` (see AUTO_PERMISSION_MODE_ARGS)
   * and never use bypass / `--dangerously-skip-permissions`. The user can still
   * type into the terminal at any time. When false, the session is spawned with
   * no permission args at all (same effective default).
   */
  autoAcceptEdits?: boolean
  timeoutMs?: number
  /** Aborts the phase: freezes the terminal and resolves with ok=false. */
  signal?: AbortSignal
  /** Invoked with the spawned terminal id so the caller can record it in state. */
  onSpawn?: (terminalId: string) => void
}

export interface ForegroundPhaseResult {
  ok: boolean
  /** Empty string for headless phases (no PTY). */
  terminalId: string
  /** ANSI-stripped tail of the terminal output, for cross-phase handoff. */
  output: string
  error?: string
}

export interface HeadlessPhaseOptions {
  /** Hook-routing not needed (no PTY/Stop hook); used only for permission seeding. */
  sessionId: string
  worktreePath: string
  /** Source repo for permission seeding (optional). */
  repoPath?: string
  claudeTheme?: string
  claudeConfigDir?: string
  /** Prompt piped to `claude -p` on stdin. */
  prompt: string
  timeoutMs?: number
  /** Aborts the phase: kills the claude process tree and resolves with ok=false. */
  signal?: AbortSignal
  /** Called for each transcript line as it streams in, so the panel can render live. */
  onTranscript?: (line: string) => void
}

/**
 * Run one review-loop phase headlessly via `claude -p` (no PTY). Seeds the same
 * worktree hooks + permission allowlist as the foreground path so an auto-mode
 * run isn't starved, streams the transcript through `onTranscript`, and resolves
 * with a {@link ForegroundPhaseResult} (terminalId is empty — there is no PTY).
 */
export async function runHeadlessPhase(
  opts: HeadlessPhaseOptions
): Promise<ForegroundPhaseResult> {
  // Same worktree prep as the foreground path: hooks (harmless here) + the
  // inherited permission allowlist so a non-bypass run can act on approved tools.
  try {
    writeClaudeHookSettings(opts.worktreePath, opts.claudeTheme ?? 'dark', opts.sessionId)
  } catch {
    // Non-fatal.
  }
  if (opts.repoPath) {
    try {
      seedPermissions(opts.repoPath, opts.worktreePath)
    } catch {
      // Non-fatal.
    }
  }

  if (opts.signal?.aborted) {
    return { ok: false, terminalId: '', output: '', error: 'cancelled' }
  }

  const env = opts.claudeConfigDir
    ? { CLAUDE_CONFIG_DIR: resolveConfigDir(opts.claudeConfigDir) }
    : undefined

  let child: import('node:child_process').ChildProcessWithoutNullStreams | undefined
  const onAbort = (): void => {
    if (child) killChildTree(child)
  }
  opts.signal?.addEventListener('abort', onAbort, { once: true })

  try {
    const result = await runHeadlessClaude({
      cwd: opts.worktreePath,
      prompt: opts.prompt,
      env,
      timeoutMs: opts.timeoutMs ?? DEFAULT_PHASE_TIMEOUT_MS,
      onTranscript: opts.onTranscript,
      onChild: (c) => {
        child = c
        // The signal may have aborted between the check above and spawn.
        if (opts.signal?.aborted) killChildTree(c)
      },
    })
    return {
      ok: result.ok,
      terminalId: '',
      output: result.transcript.join('\n'),
      error: result.error,
    }
  } finally {
    opts.signal?.removeEventListener('abort', onAbort)
  }
}

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\[[0-9;?]*[ -/]*[@-~]/g

/** Strip ANSI escape sequences so captured terminal output is plain text. */
export function stripAnsi(input: string): string {
  return input.replace(ANSI_PATTERN, '')
}

/**
 * Spawn one interactive phase terminal, wait for its Stop hook (or timeout /
 * abort), then freeze it. Resolves once the phase has settled.
 */
export function runForegroundPhase(
  opts: ForegroundPhaseOptions
): Promise<ForegroundPhaseResult> {
  return new Promise((resolve) => {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_PHASE_TIMEOUT_MS

    // Make sure the worktree has our hooks (so Stop fires) and the inherited
    // permission allowlist (so a skip-permissions-less run isn't starved).
    try {
      writeClaudeHookSettings(opts.worktreePath, opts.claudeTheme ?? 'dark', opts.sessionId)
    } catch {
      // Non-fatal — a missing Stop hook only means we fall back to the timeout.
    }
    if (opts.repoPath) {
      try {
        seedPermissions(opts.repoPath, opts.worktreePath)
      } catch {
        // Non-fatal.
      }
    }

    const claudeArgs = opts.autoAcceptEdits ? AUTO_PERMISSION_MODE_ARGS : undefined

    const terminalId = spawnTerminal(
      opts.window,
      opts.sessionId,
      opts.worktreePath,
      'claude',
      opts.claudeTheme ?? 'dark',
      opts.claudeConfigDir,
      opts.prompt,
      opts.repoPath,
      false,
      opts.sessionId, // contextId — routes the Stop hook back to this session
      opts.tabId,
      claudeArgs
    )
    opts.onSpawn?.(terminalId)

    let settled = false
    const finish = (ok: boolean, error?: string): void => {
      if (settled) return
      settled = true
      unsubscribe()
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      const output = stripAnsi(getTerminalBuffer(terminalId))
      // Freeze: kill the PTY so it can't auto-restart; xterm keeps its scrollback.
      killTerminal(terminalId)
      resolve({ ok, terminalId, output, error })
    }

    // The phase is done when its tab fires a Stop event. terminal.service also
    // synthesises a Stop on claude exit, so a crash resolves us too (as ok —
    // the caller decides success from artifacts / git state).
    const unsubscribe = onHookEvent((evt) => {
      if (evt.contextId !== opts.sessionId || evt.tabId !== opts.tabId) return
      if (evt.hookType !== 'stop') return
      finish(true)
    })

    const timer = setTimeout(() => {
      finish(false, `phase timed out after ${Math.round(timeoutMs / 60000)}m`)
    }, timeoutMs)

    const onAbort = (): void => finish(false, 'cancelled')
    if (opts.signal) {
      if (opts.signal.aborted) {
        // Already cancelled before we got going.
        finish(false, 'cancelled')
        return
      }
      opts.signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}
