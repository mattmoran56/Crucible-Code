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
} from './terminal.service'
import { onHookEvent } from './notification-server'
import { writeClaudeHookSettings } from './hook.service'
import { seedPermissions } from './permission-sync.service'

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
   * Append `--dangerously-skip-permissions` so the loop runs hands-off while
   * still fully visible/interactive. The user can still type into the terminal.
   */
  skipPermissions?: boolean
  timeoutMs?: number
  /** Aborts the phase: freezes the terminal and resolves with ok=false. */
  signal?: AbortSignal
  /** Invoked with the spawned terminal id so the caller can record it in state. */
  onSpawn?: (terminalId: string) => void
}

export interface ForegroundPhaseResult {
  ok: boolean
  terminalId: string
  /** ANSI-stripped tail of the terminal output, for cross-phase handoff. */
  output: string
  error?: string
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

    const claudeArgs = opts.skipPermissions ? ['--dangerously-skip-permissions'] : undefined

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
