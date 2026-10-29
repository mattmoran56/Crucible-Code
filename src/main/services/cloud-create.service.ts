/**
 * Interactive cloud session creation.
 *
 * Starting a NEW cloud session is interactive-only in Claude Code: `claude -p
 * --cloud` is refused ("--cloud cannot be combined with --print"), and without
 * a TTY it refuses to start one. So the session's Agent tab shows a real PTY
 * running `claude --cloud <task> --on-branch <branch>` in the worktree. The
 * user answers anything the CLI asks there (forward settings / MCP servers,
 * re-register this machine, sign in). We read the PTY output for the new
 * session's claude.ai/code URL / id and report it to the renderer, which saves
 * it and switches the tab to the embedded claude.ai page.
 *
 * The local CLI is never killed for the user: depending on the account it
 * either exits by itself once the session is created, or stays attached to the
 * cloud session as a REPL ("detach (session keeps running)"). The renderer
 * offers a Close button for the latter.
 *
 * Runs are runtime-only. After an app restart a pending session has no run;
 * the renderer offers Retry / Open claude.ai/code instead.
 */
import type { BrowserWindow } from 'electron'
import { IPC } from '../../shared/constants'
import type { CloudCreateState, CloudSessionMode } from '../../shared/types'
import * as terminalService from './terminal.service'
import {
  claudeShellCommand,
  cloudStartArgv,
  findCloudSessionInOutput,
  isUnknownOnBranchError,
  mayHaveCreatedSession,
  pushSessionBranch,
  summarizeCreateFailure,
  withBranchInstruction,
  withConnectorHold,
  withOrchestratorInstruction,
} from './cloud-session.service'

/** The Agent tab id cloud PTYs report under. */
export const CLOUD_PTY_TAB = 'agent'

/** How much recent PTY output is kept per run for parsing / error reports. */
const OUTPUT_CAP = 64 * 1024

export interface StartCloudCreateOptions {
  /** App session id (PTY owner and hook context). */
  sessionId: string
  projectId: string
  worktreePath: string
  branch: string
  task: string
  /** Default 'single-branch'. */
  mode?: CloudSessionMode
  configDir?: string | null
  repoPath?: string
  claudeTheme?: string
}

interface Run {
  state: CloudCreateState
  output: string
  unwatch?: () => void
  window: BrowserWindow
}

const runs = new Map<string, Run>()

const snapshot = (run: Run): CloudCreateState => ({ ...run.state })

function emit(run: Run): void {
  const win = run.window
  if (win && !win.isDestroyed?.()) win.webContents?.send(IPC.CLOUD_SESSION_CREATE_EVENT, snapshot(run))
}

export function getCloudCreateState(sessionId: string): CloudCreateState | null {
  const run = runs.get(sessionId)
  return run ? snapshot(run) : null
}

/** Forget a run (session removed). Does not touch the PTY; killSessionTerminals does. */
export function forgetCloudCreate(sessionId: string): void {
  runs.get(sessionId)?.unwatch?.()
  runs.delete(sessionId)
}

/**
 * The `--cloud` task for a run. A single-branch session is told to push only
 * to its branch; an orchestrator is told it may move between branches. Either
 * way it holds until the renderer's kickoff message, which brings the claude.ai
 * connectors with it (see withConnectorHold).
 */
const createTask = (opts: Pick<StartCloudCreateOptions, 'task' | 'branch' | 'mode'>): string =>
  withConnectorHold(
    opts.mode === 'orchestrator'
      ? withOrchestratorInstruction(opts.task, opts.branch)
      : withBranchInstruction(opts.task, opts.branch)
  )

function spawnCreatePty(run: Run, opts: StartCloudCreateOptions, withOnBranch: boolean): void {
  // An orchestrator is never pinned with --on-branch: it starts on the pushed
  // branch (the worktree's current one) and may push others.
  const pin = withOnBranch && opts.mode !== 'orchestrator'
  const argv = cloudStartArgv(createTask(opts), pin ? opts.branch : undefined)
  // One cloud PTY per session Agent tab; spawnTerminal is idempotent per tab.
  terminalService.killTerminalsForTab(opts.sessionId, CLOUD_PTY_TAB)
  const terminalId = terminalService.spawnTerminal(
    run.window,
    opts.sessionId,
    opts.worktreePath,
    'command',
    opts.claudeTheme ?? 'dark',
    opts.configDir ?? undefined,
    claudeShellCommand(argv),
    opts.repoPath,
    false,
    opts.sessionId,
    CLOUD_PTY_TAB
  )
  run.output = ''
  run.state = { ...run.state, terminalId, status: 'running', attached: true, error: undefined, mayExist: undefined }
  run.unwatch?.()
  run.unwatch = terminalService.watchTerminal(terminalId, {
    onData: (data) => {
      if (runs.get(opts.sessionId) !== run || run.state.terminalId !== terminalId) return
      run.output = (run.output + data).slice(-OUTPUT_CAP)
      if (run.state.status !== 'running') return
      const found = findCloudSessionInOutput(run.output)
      if (!found) return
      run.state = { ...run.state, status: 'created', result: { ...found, branch: opts.branch } }
      emit(run)
    },
    onExit: (code) => {
      if (runs.get(opts.sessionId) !== run || run.state.terminalId !== terminalId) return
      run.unwatch = undefined
      if (run.state.status === 'running') {
        // Last chance: the id may have arrived in the final chunk.
        const found = findCloudSessionInOutput(run.output)
        if (found) {
          run.state = { ...run.state, status: 'created', result: { ...found, branch: opts.branch }, attached: false }
          emit(run)
          return
        }
        if (pin && isUnknownOnBranchError(run.output)) {
          // A CLI without --on-branch: the VM still clones the pushed branch
          // (the worktree's current branch) and the task text steers it.
          spawnCreatePty(run, opts, false)
          emit(run)
          return
        }
        const tail = summarizeCreateFailure(run.output)
        run.state = {
          ...run.state,
          status: 'failed',
          attached: false,
          mayExist: mayHaveCreatedSession(run.output) || undefined,
          error: tail
            ? `Claude did not create a cloud session (exit ${code}):\n${tail}`
            : `Claude exited (code ${code}) without creating a cloud session`,
        }
      } else {
        run.state = { ...run.state, attached: false }
      }
      emit(run)
    },
  })
}

/**
 * Push the branch, then start the interactive create PTY. Resolves with the
 * run's first snapshot (status 'running', terminal id set) or a 'failed' one
 * when the push or spawn failed. Starting again replaces an earlier run.
 */
export async function startCloudCreate(window: BrowserWindow, opts: StartCloudCreateOptions): Promise<CloudCreateState> {
  const task = opts.task?.trim()
  if (!task) throw new Error('A cloud session needs a task description to start')
  // Validates the branch and task before anything runs.
  cloudStartArgv(createTask({ ...opts, task }), opts.branch)

  forgetCloudCreate(opts.sessionId)
  const run: Run = {
    window,
    output: '',
    state: { sessionId: opts.sessionId, projectId: opts.projectId, terminalId: null, status: 'running', attached: false },
  }
  runs.set(opts.sessionId, run)

  try {
    await pushSessionBranch(opts.worktreePath, opts.branch)
    if (runs.get(opts.sessionId) !== run) return snapshot(run)
    spawnCreatePty(run, { ...opts, task }, true)
  } catch (err) {
    run.state = { ...run.state, status: 'failed', attached: false, error: err instanceof Error ? err.message : String(err) }
  }
  return snapshot(run)
}

/** Test hook. */
export function _resetCloudCreateRuns(): void {
  for (const id of [...runs.keys()]) forgetCloudCreate(id)
}
