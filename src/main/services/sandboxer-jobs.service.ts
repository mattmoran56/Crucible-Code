import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import type { BrowserWindow } from 'electron'
import { IPC } from '../../shared/constants'
import type { SandboxJob } from '../../shared/types'

/**
 * Long-running sandboxer commands (`up`, front-end builds) run here rather than
 * in a terminal tab, so the Sandbox panel can show their progress itself. One
 * job per worktree; its output is kept so a panel opened mid-build (or after
 * it failed) can show what happened.
 */

const MAX_LINES = 400
// Throttle pushes to the renderer: a Docker build prints hundreds of lines a second.
const EMIT_MS = 250

interface Job {
  state: SandboxJob
  child: ChildProcess | null
  window: BrowserWindow | null
  emitTimer: ReturnType<typeof setTimeout> | null
}

const jobs = new Map<string, Job>()

type Spawn = (args: string[], cwd: string) => ChildProcess
const defaultSpawn: Spawn = (args, cwd) =>
  spawn('sandboxer', args, {
    cwd: existsSync(cwd) ? cwd : homedir(),
    // Plain text: no colours or progress redraws in what we show.
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
  })
let spawnSandboxer: Spawn = defaultSpawn

/** Test seam: swap the spawner. Pass nothing to restore the default. */
export function setSpawnForTests(fn?: Spawn): void {
  spawnSandboxer = fn ?? defaultSpawn
}

const snapshot = (job: Job): SandboxJob => ({ ...job.state, lines: [...job.state.lines] })

function emitNow(job: Job): void {
  if (job.emitTimer) clearTimeout(job.emitTimer)
  job.emitTimer = null
  const win = job.window
  if (win && !win.isDestroyed?.()) win.webContents?.send(IPC.SANDBOXER_JOB_EVENT, snapshot(job))
}

function emitSoon(job: Job): void {
  if (!job.emitTimer) job.emitTimer = setTimeout(() => emitNow(job), EMIT_MS)
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g

function addOutput(job: Job, chunk: string, carry: { rest: string }): void {
  const text = carry.rest + chunk.replace(ANSI, '')
  const parts = text.split(/\r?\n|\r/)
  carry.rest = parts.pop() ?? ''
  for (const raw of parts) {
    const line = raw.trimEnd()
    if (!line.trim()) continue
    job.state.lines.push(line)
    // sandboxer marks each step with `==>`; that is the headline the panel shows.
    const step = /^\s*==>\s*(.+)$/.exec(line)
    if (step) job.state.step = step[1]
  }
  if (job.state.lines.length > MAX_LINES) job.state.lines.splice(0, job.state.lines.length - MAX_LINES)
  emitSoon(job)
}

/** The current or last job for a worktree, if this app run started one. */
export function getJob(worktreePath: string): SandboxJob | null {
  const job = jobs.get(worktreePath)
  return job ? snapshot(job) : null
}

/**
 * Start a sandboxer command for a worktree. Refuses while one is already
 * running there — two `up`s racing on one sandbox help nobody.
 */
export function startJob(
  window: BrowserWindow | null,
  worktreePath: string,
  title: string,
  args: string[]
): SandboxJob {
  const existing = jobs.get(worktreePath)
  if (existing?.state.state === 'running') throw new Error(`${existing.state.title} is still running`)

  const job: Job = {
    state: {
      worktreePath,
      title,
      state: 'running',
      lines: [`$ sandboxer ${args.join(' ')}`],
      step: null,
      startedAt: new Date().toISOString(),
    },
    child: null,
    window,
    emitTimer: null,
  }
  jobs.set(worktreePath, job)

  const finish = (code: number | null, error?: string) => {
    if (job.state.state !== 'running') return
    if (error) job.state.lines.push(error)
    job.state.state = code === 0 ? 'succeeded' : 'failed'
    job.state.exitCode = code
    job.state.finishedAt = new Date().toISOString()
    job.child = null
    emitNow(job)
  }

  try {
    const child = spawnSandboxer(args, worktreePath)
    job.child = child
    const out = { rest: '' }
    const err = { rest: '' }
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (c: string) => addOutput(job, c, out))
    child.stderr?.on('data', (c: string) => addOutput(job, c, err))
    child.on('error', (e) => finish(null, e.message))
    child.on('close', (code) => {
      for (const carry of [out, err]) if (carry.rest) addOutput(job, '\n', carry)
      finish(code)
    })
  } catch (e) {
    finish(null, e instanceof Error ? e.message : String(e))
  }
  emitNow(job)
  return snapshot(job)
}

/** Stop a running job (the sandbox itself is left as sandboxer left it). */
export function cancelJob(worktreePath: string): void {
  jobs.get(worktreePath)?.child?.kill('SIGINT')
}

/** Kill every running job — on app quit. */
export function killAllJobs(): void {
  for (const job of jobs.values()) job.child?.kill('SIGINT')
}

/** Test-only: forget every job. */
export function _resetJobs(): void {
  for (const job of jobs.values()) if (job.emitTimer) clearTimeout(job.emitTimer)
  jobs.clear()
}
